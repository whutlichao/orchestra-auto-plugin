// Read-only observatory panel for orchestra-auto runs.
//
// The main view is the recorded topology drawn as a node-and-link graph: a
// coordinator hub over a spine, a dashed run-membership tick into each top-level
// worker (two lanes), and solid elbows only for recorded parent_worker_id values.
// A node shows its name, task and status; selecting it expands the recorded facts
// full width under its lane pair. Stale is one run-level phrase, not a badge on
// every node. Attention and run details open on demand. Missing, invalid, cyclic,
// truncated, stale and unavailable states stay explicit. Nothing is written or
// executed.
import {
  Badge,
  Box,
  Button,
  Callout,
  Collapsible,
  EmptyState,
  Heading,
  IconButton,
  KeyValue,
  List,
  ListItem,
  read,
  RelativeTime,
  Row,
  Select,
  Separator,
  set,
  Spinner,
  Stack,
  Table,
  Text
} from 'orca'
import {
  DELIVERY_FIELDS,
  cleanText,
  recordedTaskId,
  type ArtifactView,
  type DeliveryField,
  type EventView,
  type Freshness,
  type RunAvailability,
  type RunHealth,
  type RunListing,
  type RunMode,
  type RunSource,
  type RunStatus,
  type RunSummary,
  type RunView,
  type StartConfirmation,
  type TaskStatus,
  type TaskView,
  type WorkerLifecycle
} from './contract'
import {
  buildTopology,
  topologyNode,
  type Topology,
  type TopologyWorker,
  type WorkerRelation
} from './topology'
import {
  attentionOpen,
  detail,
  detailError,
  detailLoading,
  detailsOpen,
  listing,
  listingError,
  loading,
  refresh,
  selectRun,
  selectedRunId,
  selectedWorkerId
} from './panel-state'
import {
  planGraph,
  planRunGraph,
  type GraphPlan,
  type GraphRow,
  type MemberBlock,
  type RunGraphPlan
} from './graph'

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export { setup } from './panel-state'

const TASK_LIMIT = 100
const DELIVERY_LIMIT = 100
const ARTIFACT_LIMIT = 50
const WARNING_LIMIT = 6
const ATTENTION_LIMIT = 10
const DETACHED_TASK_LIMIT = 50
const WORKER_ROW_LIMIT = 100
// The coordinator's spine: one lane tick per side plus the trunk itself.
const SPINE_WIDTH = 28
const SPINE_TICK_Y = 18
const SPINE_DASH = 3
const SPINE_GAP = 2
// One rail cell per recorded ancestor level inside a lane, plus its elbow. A
// small inset keeps a lane's branch rails visibly clear of the coordinator spine.
const NEST_INDENT = 6
const NEST_INSET = 4
const NEST_TICK_Y = 18
// The spine and its membership ticks are 2 px accent lines; recorded parent
// edges are 1 px solid accent lines. Dashed/thicker vs solid/thinner keeps the
// two edge kinds distinguishable without relying on colour alone.
const LINE = 2
const PARENT_LINE = 1

const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  unknown: '未知',
  active: '进行中',
  waiting_user: '等待用户',
  failed: '失败',
  paused: '已暂停',
  completed: '已完成',
  cancelled: '已取消'
}

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  unknown: '未知',
  pending: '待处理',
  ready: '就绪',
  running: '运行中',
  blocked: '阻塞',
  waiting_user: '等待用户',
  reported: '已自报',
  accepted: '已验收',
  rejected: '已打回',
  failed: '失败',
  paused: '暂停',
  cancelled: '已取消'
}

const LIFECYCLE_LABEL: Record<WorkerLifecycle, string> = {
  unknown: '未知',
  dispatched: '已派发',
  running: '运行中',
  waiting_user: '等待用户',
  reported_done: '自报完成',
  failed: '失败',
  lost: '失联',
  reclaimable: '可回收',
  closed: '已关闭'
}

const START_LABEL: Record<StartConfirmation, string> = {
  unknown: '未知',
  observed: '已观察',
  unobserved: '未观察到',
  unsupported: '旧版不支持'
}

const HEALTH_LABEL: Record<RunHealth, string> = {
  healthy: '健康',
  degraded: '降级',
  blocked: '阻塞',
  lost: '失联',
  unknown: '未知'
}

const FRESHNESS_LABEL: Record<Freshness, string> = {
  current: '当前',
  stale: '已过期',
  unknown: '未知'
}

const MODE_LABEL: Record<RunMode, string> = {
  REAL: 'REAL',
  DEMO: 'DEMO',
  unknown: '未知'
}

const SOURCE_LABEL: Record<RunSource, string> = {
  registry: '注册表',
  'audit-root': '审计目录'
}

const AVAILABILITY_LABEL: Record<RunAvailability, string> = {
  available: '可读',
  unavailable: '不可用',
  corrupt: '损坏'
}

// A completed status is recorded state, not a claim that every delivery is
// verified, so it keeps the neutral tone.
const RUN_STATUS_TONE: Record<RunStatus, Tone> = {
  unknown: 'neutral',
  active: 'accent',
  waiting_user: 'warning',
  failed: 'danger',
  paused: 'warning',
  completed: 'neutral',
  cancelled: 'neutral'
}

const HEALTH_TONE: Record<RunHealth, Tone> = {
  healthy: 'success',
  degraded: 'warning',
  blocked: 'warning',
  lost: 'danger',
  unknown: 'neutral'
}

const AVAILABILITY_TONE: Record<RunAvailability, Tone> = {
  available: 'neutral',
  unavailable: 'warning',
  corrupt: 'danger'
}

const DELIVERY_LABEL: Record<DeliveryField, string> = {
  implemented: '已实施',
  integrated: '已集成',
  merged: '已合并',
  tracker_closed: 'tracker 关闭'
}

const ERROR_TITLE: Record<string, string> = {
  run_corrupt: '快照损坏',
  run_unavailable: '运行不可用',
  run_not_found: '运行不存在',
  timeout: '读取超时'
}

function freshnessTone(freshness: Freshness): Tone {
  return freshness === 'stale' ? 'warning' : 'neutral'
}

function truthLabel(value: boolean | null): string {
  if (value === true) return '是'
  if (value === false) return '否'
  return '未核验'
}

function taskNote(task: TaskView): string {
  const notes: string[] = []
  if (task.provisional) notes.push('临时')
  if (task.blockedReason) notes.push('阻塞：' + task.blockedReason)
  if (task.pendingDecision) notes.push('待决：' + task.pendingDecision)
  return cleanText(notes.join('；') || '—', 180)
}

function optionLabel(run: RunSummary): string {
  const suffix = run.availability === 'available' ? '' : ' · ' + AVAILABILITY_LABEL[run.availability]
  return cleanText(RUN_STATUS_LABEL[run.status] + ' · ' + run.label + suffix, 100)
}

function summaryLabel(run: RunSummary | undefined): string {
  if (!run) return ''
  return run.label || run.id
}

function errorTitle(error: { code: string }): string {
  return ERROR_TITLE[error.code] ?? '读取失败'
}

/** Show both numbers only when the render budget hid some top-level workers. */
function memberCount(members: number, memberTotal: number): string {
  return members === memberTotal ? String(members) : members + ' / ' + memberTotal
}

function TimeRow({ label, at }: { label: string; at: number | null }) {
  return (
    <Row gap="sm" align="center">
      <Text muted size="xs">
        {label}
      </Text>
      {at === null ? <Text size="xs">未知</Text> : <RelativeTime at={at} muted />}
    </Row>
  )
}

function WarningLines({ lines }: { lines: string[] }) {
  const shown = lines.slice(0, WARNING_LIMIT)
  return (
    <Stack gap="xs">
      {shown.map((line, index) => (
        <Text key={index} size="xs">
          • {line}
        </Text>
      ))}
      {lines.length > WARNING_LIMIT ? (
        <Text muted size="xs">
          还有 {lines.length - WARNING_LIMIT} 条提示未显示。
        </Text>
      ) : null}
    </Stack>
  )
}

const RELATION_DISPLAY: Record<
  WorkerRelation,
  { badge: string; text: (parent: string) => string; tone: Tone }
> = {
  root: {
    badge: '未记录父 Worker',
    text: () => '未记录父 Worker（运行归属连线）',
    tone: 'neutral'
  },
  child: {
    badge: '父子关系已记录',
    text: (parent) => '父 Worker ' + parent,
    tone: 'neutral'
  },
  'missing-parent': {
    badge: '父节点缺失',
    text: (parent) => '父 ' + parent + ' 未记录',
    tone: 'warning'
  },
  'invalid-parent': {
    badge: '父关系无效',
    text: () => '父 Worker 记录无效',
    tone: 'warning'
  },
  'unresolved-parent': {
    badge: '父节点未读取',
    text: (parent) => '父 ' + parent + ' 不在已读取的 Worker 中（可能因投影上限）',
    tone: 'warning'
  },
  cycle: {
    badge: '父关系成环',
    text: (parent) => '父关系成环（父 ' + parent + '）',
    tone: 'danger'
  },
  'depth-limit': {
    badge: '层级过深',
    text: (parent) => '层级过深，未继续缩进（父 ' + parent + '）',
    tone: 'warning'
  }
}

function workerTaskText(node: TopologyWorker): string {
  if (node.task) return node.task.title
  const taskId = recordedTaskId(node.worker)
  if (taskId !== null) return taskId + '（未记录于 tasks）'
  if (node.worker.taskState === 'invalid') return '记录无效'
  return '未记录'
}

function relationText(node: TopologyWorker): string {
  return RELATION_DISPLAY[node.relation].text(node.parentId ?? '未记录')
}

const LIFECYCLE_TONE: Record<WorkerLifecycle, Tone> = {
  unknown: 'neutral',
  dispatched: 'neutral',
  running: 'accent',
  waiting_user: 'warning',
  reported_done: 'neutral',
  failed: 'danger',
  lost: 'danger',
  reclaimable: 'neutral',
  closed: 'neutral'
}

/** A short recorded fact with the tone it should carry. */
type ToneLabel = { label: string; tone: Tone }

/** A wrapping row of short recorded facts; renders nothing when there are none. */
function ToneBadges({ items }: { items: ToneLabel[] }) {
  if (items.length === 0) return null
  return (
    <Row gap="xs" wrap>
      {items.map((item, index) => (
        <Badge key={index} tone={item.tone}>
          {item.label}
        </Badge>
      ))}
    </Row>
  )
}

/** Card border: selection, then recorded trouble. A clean row keeps the neutral border. */
function nodeBorder(node: TopologyWorker, selected: boolean): true | Tone {
  if (selected) return 'accent'
  if (node.relation === 'cycle') return 'danger'
  if (node.worker.lifecycle === 'failed' || node.worker.lifecycle === 'lost') return 'danger'
  if (node.attention.length > 0) return 'warning'
  return true
}

/**
 * Recorded markers only: attention count, unobserved start and a relation gap.
 * Stale observation is a run-level fact, so it is deliberately not repeated
 * here; the run summary states it once.
 */
function nodeMarkers(node: TopologyWorker): ToneLabel[] {
  const markers: ToneLabel[] = []
  if (node.attention.length > 0) {
    markers.push({ label: '需关注 ' + node.attention.length, tone: 'warning' })
  }
  if (node.worker.startConfirmation === 'unobserved') {
    markers.push({ label: '启动未观察', tone: 'warning' })
  }
  if (node.relation !== 'root' && node.relation !== 'child') {
    markers.push({
      label: RELATION_DISPLAY[node.relation].badge,
      tone: RELATION_DISPLAY[node.relation].tone
    })
  }
  return markers
}

/**
 * One graph node: the worker's name, its recorded task and its status. The whole
 * card is the press target, so it is reachable and activatable from the keyboard.
 * Only recorded trouble adds markers; the stale observation is a run-level fact
 * and is stated once, not repeated on every node.
 */
function WorkerNode({ node, selected }: { node: TopologyWorker; selected: boolean }) {
  return (
    <Box border={nodeBorder(node, selected)} radius="sm" background="card" width="100%">
      <List label={'Worker ' + node.worker.id}>
        <ListItem
          icon="bot"
          title={cleanText(node.worker.id, 60)}
          description={cleanText(workerTaskText(node), 160)}
          current={selected}
          onPress={() => set(selectedWorkerId, selected ? '' : node.worker.id)}
        >
          <Row gap="xs" wrap align="center">
            <Badge tone={LIFECYCLE_TONE[node.worker.lifecycle]}>
              {LIFECYCLE_LABEL[node.worker.lifecycle]}
            </Badge>
            {nodeMarkers(node).map((marker, index) => (
              <Badge key={index} tone={marker.tone}>
                {marker.label}
              </Badge>
            ))}
          </Row>
        </ListItem>
      </List>
    </Box>
  )
}

/**
 * The selected node's recorded facts, full width under its lane pair so a narrow
 * lane never squeezes them. The close control duplicates the node press, which
 * stays the primary toggle.
 */
function SelectedDetail({ node, onClose }: { node: TopologyWorker; onClose: () => void }) {
  return (
    <Box border="accent" radius="sm" background="card" padding="sm" marginY="xs">
      <Stack gap="sm">
        <Row justify="between" align="center" gap="sm">
          <Text size="sm" weight="medium">
            {'Worker 详情 · ' + cleanText(node.worker.id, 60)}
          </Text>
          <IconButton
            icon="close"
            label="收起详情"
            tooltip="收起该 Worker 的详情"
            size="sm"
            variant="ghost"
            onPress={onClose}
          />
        </Row>
        <WorkerDetail node={node} />
      </Stack>
    </Box>
  )
}

function AttentionList({ view }: { view: RunView }) {
  if (view.attention.length === 0) {
    return (
      <Text muted size="xs">
        没有已记录的阻塞、待决或失败。
      </Text>
    )
  }
  return (
    <Stack gap="xs">
      {view.attention.slice(0, ATTENTION_LIMIT).map((item) => (
        <Text key={item.id} size="xs">
          • {item.text}
        </Text>
      ))}
      {view.attentionTotal > ATTENTION_LIMIT ? (
        <Text muted size="xs">
          还有 {view.attentionTotal - ATTENTION_LIMIT} 项未显示。
        </Text>
      ) : null}
    </Stack>
  )
}

function WorkerDetail({ node }: { node: TopologyWorker }) {
  const items = [
    { label: 'Worker', value: node.worker.id, code: true },
    { label: '任务', value: workerTaskText(node) },
    { label: '关系', value: relationText(node) },
    { label: 'Dispatch', value: node.worker.dispatchId ?? '未记录', code: node.worker.dispatchId !== null },
    { label: '尝试', value: node.worker.attempt ?? '未知' },
    ...(node.descendantCount > 0
      ? [{ label: '下属 Worker', value: node.descendantCount }]
      : []),
    { label: '核验生命周期', value: LIFECYCLE_LABEL[node.worker.lifecycle] },
    { label: '自报生命周期', value: LIFECYCLE_LABEL[node.worker.reportedLifecycle] },
    { label: '启动确认', value: START_LABEL[node.worker.startConfirmation] },
    { label: '时效', value: FRESHNESS_LABEL[node.worker.freshness] },
    { label: '工作区', value: node.worker.worktree || '未记录' },
    { label: '自报摘要', value: node.worker.reportedSummary || '未记录' }
  ]
  return (
    <Stack gap="sm">
      <Row gap="xs" wrap>
        <Badge tone={RELATION_DISPLAY[node.relation].tone}>
          {RELATION_DISPLAY[node.relation].badge}
        </Badge>
        <Badge tone="neutral">{LIFECYCLE_LABEL[node.worker.lifecycle]}</Badge>
        {node.worker.freshness === 'stale' ? <Badge tone="warning">观测已过期</Badge> : null}
        {node.worker.startConfirmation === 'unobserved' ? (
          <Badge tone="warning">启动未观察到</Badge>
        ) : null}
      </Row>
      <KeyValue items={items} />
      {node.attention.length > 0 ? (
        <Callout tone="warning" title="该 Worker 需要关注">
          <Stack gap="xs">
            {node.attention.map((item) => (
              <Text key={item.id} size="xs">
                • {item.text}
              </Text>
            ))}
          </Stack>
        </Callout>
      ) : (
        <Text muted size="xs">
          没有记录到该 Worker 或其任务的问题。
        </Text>
      )}
      <Text muted size="xs">
        自报不等于验收；关系与任务只来自记录字段，未记录的值不会被推断。
      </Text>
    </Stack>
  )
}

/**
 * The coordinator: the graph's hub. Its card is compact and centred over the
 * spine, and the spine leaves from its bottom to join every member lane.
 */
function CoordinatorNode({
  view,
  members,
  memberTotal
}: {
  view: RunView
  members: number
  memberTotal: number
}) {
  return (
    <Stack gap="none" align="center">
      <Box
        border="accent"
        radius="sm"
        background="card"
        paddingX="sm"
        paddingY="xs"
        width="90%"
        maxWidth={260}
      >
        <Row justify="between" align="center" gap="sm" wrap>
          <Text size="sm" weight="medium" truncate>
            协调者
          </Text>
          <Badge tone={RUN_STATUS_TONE[view.status]}>{RUN_STATUS_LABEL[view.status]}</Badge>
        </Row>
        <Text muted size="xs" truncate>
          {'本运行 · ' + memberCount(members, memberTotal) + ' 个顶层 Worker'}
        </Text>
      </Box>
      {members > 0 ? <Box width={LINE} height={10} border="accent" /> : null}
    </Stack>
  )
}

function TopologyBadges({ topology }: { topology: Topology }) {
  const markers: ToneLabel[] = []
  if (topology.counts.workersWithoutRecordedTask > 0) {
    markers.push({
      label: '未记录任务 ' + topology.counts.workersWithoutRecordedTask,
      tone: 'warning'
    })
  }
  if (topology.counts.workersWithInvalidTask > 0) {
    markers.push({
      label: '任务记录无效 ' + topology.counts.workersWithInvalidTask,
      tone: 'warning'
    })
  }
  if (topology.detachedTasks.length > 0) {
    markers.push({ label: '未关联任务 ' + topology.detachedTasks.length, tone: 'neutral' })
  }
  return <ToneBadges items={markers} />
}

/**
 * One dashed membership tick. Three short strokes read as a dashed line at both
 * 280 px and a wide sidebar, and a dashed line is never mistaken for the solid
 * recorded-parent edge.
 */
function MembershipTick() {
  return (
    <Row gap="none" align="center">
      {[0, 1, 2].map((index) => (
        <Row key={index} gap="none" align="center">
          {index > 0 ? <Box width={SPINE_GAP} height={LINE} /> : null}
          <Box width={SPINE_DASH} height={LINE} border="accent" />
        </Row>
      ))}
    </Row>
  )
}

/**
 * The coordinator's spine cell: the solid accent trunk plus a dashed tick into
 * each occupied lane. The trunk stretches to the row's height, so consecutive
 * rows read as one continuous spine.
 */
function SpineCell({ left, right }: { left: boolean; right: boolean }) {
  return (
    <Box width={SPINE_WIDTH} direction="row" align="stretch" gap="none">
      <Box width={13} direction="column" align="stretch" gap="none">
        <Box height={SPINE_TICK_Y} />
        {left ? <MembershipTick /> : null}
      </Box>
      <Box width={LINE} border="accent" />
      <Box width={13} direction="column" align="stretch" gap="none">
        <Box height={SPINE_TICK_Y} />
        {right ? <MembershipTick /> : null}
      </Box>
    </Box>
  )
}

/**
 * One planned row of recorded worker edges: solid accent rails, one cell per
 * recorded ancestor whose trunk continues past this row, then the elbow into
 * the card. A row whose parent was not recorded never reaches this renderer.
 */
function RecordedNodeRow({ row, selectedId }: { row: GraphRow; selectedId: string }) {
  const selected = row.node.worker.id === selectedId
  const card = (
    <Box direction="column" paddingY="xs" gap="sm">
      <WorkerNode node={row.node} selected={selected} />
      {row.cutChildren > 0 ? (
        <Text muted size="xs">
          {'还有 ' + row.cutChildren + ' 个下层 Worker 未显示'}
        </Text>
      ) : null}
    </Box>
  )
  if (row.depth === 0) return card
  return (
    <Row align="stretch" gap="none">
      <Box width={NEST_INSET} />
      {row.rails.map((active, index) => (
        <Box key={'rail-' + index} width={NEST_INDENT} direction="row" align="stretch">
          {active ? <Box width={PARENT_LINE} border="accent" /> : null}
        </Box>
      ))}
      <Box width={NEST_INDENT} direction="column" align="stretch">
        <Box width={PARENT_LINE} height={NEST_TICK_Y} border="accent" />
        <Box width={NEST_INDENT} height={PARENT_LINE} border="accent" />
        {row.hasFollowingSibling ? (
          <Box grow={true} direction="row" align="stretch" justify="start">
            <Box width={PARENT_LINE} border="accent" />
          </Box>
        ) : null}
      </Box>
      <Box grow={true} direction="column">
        {card}
      </Box>
    </Row>
  )
}

/** One top-level worker and its recorded subtree, drawn inside one lane. */
function MemberLane({ block, selectedId }: { block: MemberBlock; selectedId: string }) {
  return (
    <Box direction="column" gap="none" width="100%">
      <WorkerNode node={block.node} selected={block.node.worker.id === selectedId} />
      {block.children.length > 0 ? (
        <Stack gap="none">
          {block.children.map((row) => (
            <RecordedNodeRow key={'child:' + row.node.worker.id} row={row} selectedId={selectedId} />
          ))}
        </Stack>
      ) : null}
      {block.cutChildren > 0 ? (
        <Text muted size="xs">
          {'还有 ' + block.cutChildren + ' 个下层 Worker 未显示'}
        </Text>
      ) : null}
    </Box>
  )
}

function blockHasWorker(block: MemberBlock | null, workerId: string): boolean {
  if (block === null) return false
  return (
    block.node.worker.id === workerId ||
    block.children.some((row) => row.node.worker.id === workerId)
  )
}

/** Every worker ID a member block draws, including its recorded children. */
function memberNodeIds(block: MemberBlock | null): string[] {
  if (block === null) return []
  return [block.node.worker.id, ...block.children.map((row) => row.node.worker.id)]
}

/**
 * One lane pair around the spine. The selected node's detail is drawn full width
 * under the pair, so a lane's narrow width never squeezes the recorded facts.
 */
function MembershipRow({
  row,
  selectedNode
}: {
  row: RunGraphPlan['rows'][number]
  selectedNode: TopologyWorker | null
}) {
  const selectedId = selectedNode?.worker.id ?? ''
  const showDetail =
    selectedNode !== null &&
    (blockHasWorker(row.left, selectedNode.worker.id) ||
      blockHasWorker(row.right, selectedNode.worker.id))
  return (
    <Stack gap="none">
      <Row align="stretch" gap="none" justify="center">
        <Box grow={true} width={0} minWidth={0} direction="column" align="end" paddingY="xs">
          {row.left ? <MemberLane block={row.left} selectedId={selectedId} /> : null}
        </Box>
        <SpineCell left={row.left !== null} right={row.right !== null} />
        <Box grow={true} width={0} minWidth={0} direction="column" align="start" paddingY="xs">
          {row.right ? <MemberLane block={row.right} selectedId={selectedId} /> : null}
        </Box>
      </Row>
      {showDetail && selectedNode !== null ? (
        <SelectedDetail node={selectedNode} onClose={() => set(selectedWorkerId, '')} />
      ) : null}
    </Stack>
  )
}

/**
 * The run graph: coordinator hub, spine, and one dashed membership edge per
 * top-level worker. Members are paired into two lanes so the graph stays compact
 * in a narrow sidebar; recorded parent edges stay solid and inside their lane.
 */
function MembershipGraph({
  view,
  plan,
  selectedNode
}: {
  view: RunView
  plan: RunGraphPlan
  selectedNode: TopologyWorker | null
}) {
  return (
    <Stack gap="none">
      <CoordinatorNode
        view={view}
        members={plan.members}
        memberTotal={plan.memberTotal}
      />
      {plan.rows.map((row, index) => (
        <MembershipRow key={'pair:' + index} row={row} selectedNode={selectedNode} />
      ))}
    </Stack>
  )
}

/** Recorded edges that cannot be placed: kept explicit, never attached to the run. */
function AnomalyGroup({
  topology,
  plan,
  selectedId
}: {
  topology: Topology
  plan: GraphPlan
  selectedId: string
}) {
  const cyclePresent = topology.anomalies.some((each) => each.relation === 'cycle')
  const tone: Tone = cyclePresent ? 'danger' : 'warning'
  return (
    <Box border={tone} radius="sm" padding="sm" direction="column" gap="sm">
      <Row justify="between" align="center" gap="sm">
        <Text size="sm" weight="medium">
          {'关系异常 · ' + topology.anomalies.length}
        </Text>
        <Badge tone={tone}>未并入协调者</Badge>
      </Row>
      <Text muted size="xs">
        父节点缺失、无效、未读取或成环；这些 Worker 不并入协调者，因此没有运行归属连线。
        {topology.depthLimited > 0
          ? ' 其中 ' + topology.depthLimited + ' 个因层级过深而平铺。'
          : ''}
      </Text>
      <Stack gap="none">
        {plan.rows.map((row) => (
          <Stack key={'anomaly:' + row.node.worker.id} gap="none">
            <RecordedNodeRow row={row} selectedId={selectedId} />
            {row.node.worker.id === selectedId ? (
              <SelectedDetail node={row.node} onClose={() => set(selectedWorkerId, '')} />
            ) : null}
          </Stack>
        ))}
      </Stack>
      {plan.truncated ? (
        <Text muted size="xs">
          关系异常中仅显示前 {WORKER_ROW_LIMIT} 个 Worker（含嵌套节点），共 {plan.total} 个。
        </Text>
      ) : null}
    </Box>
  )
}

function DetachedTasks({ tasks }: { tasks: TaskView[] }) {
  return (
    <Collapsible
      title={'未关联任务 · ' + tasks.length}
      description="没有 Worker 的 task_id 指向它们"
    >
      <Stack gap="sm">
        {tasks.slice(0, DETACHED_TASK_LIMIT).map((task) => (
          <Stack key={'task:' + task.id} gap="xs">
            <Text size="sm">{task.id}</Text>
            <Text size="xs">
              {cleanText(task.title, 160)} · 状态 {TASK_STATUS_LABEL[task.status]}
              {task.dependencies.length > 0 ? ' · 依赖 ' + task.dependencies.join(', ') : ''}
            </Text>
          </Stack>
        ))}
        {tasks.length > DETACHED_TASK_LIMIT ? (
          <Text muted size="xs">
            未关联任务仅显示前 {DETACHED_TASK_LIMIT} 个，共 {tasks.length} 个。
          </Text>
        ) : null}
        <Text muted size="xs">未关联不代表没有执行。</Text>
      </Stack>
    </Collapsible>
  )
}

function TopologySection({
  view,
  topology,
  workerId
}: {
  view: RunView
  topology: Topology
  workerId: string
}) {
  if (view.workers.length === 0) {
    return (
      <Stack gap="md">
        {view.workerTotal > 0 ? (
          <Callout tone="danger" title="Worker 记录不在已读取的数据中">
            <Text size="xs">
              快照记录了 {view.workerTotal} 个 Worker，但投影结果没有 Worker；不能据此判断无人执行。
            </Text>
          </Callout>
        ) : (
          <EmptyState
            title="没有 Worker 记录"
            description="快照的 workers 为空；这不代表没有执行。任务记录见“运行详情”。"
            icon="agent"
          />
        )}
      </Stack>
    )
  }

  const rootPlan = planRunGraph(topology.roots, WORKER_ROW_LIMIT)
  const anomalyPlan = planGraph(topology.anomalies, WORKER_ROW_LIMIT)
  const node = workerId ? topologyNode(topology, workerId) : null
  const shownIds = new Set([
    ...rootPlan.rows.flatMap((row) => [row.left, row.right]).flatMap(memberNodeIds),
    ...anomalyPlan.rows.map((row) => row.node.worker.id)
  ])
  return (
    <Stack gap="md">
      <TopologyBadges topology={topology} />
      {topology.projectionTruncated ? (
        <Callout tone="warning" title="Worker 投影已截断">
          <Text size="xs">
            快照记录了 {view.workerTotal} 个 Worker，这里只读取了前 {view.workers.length} 个；父节点位于未读取部分时显示为“不在已读取的 Worker 中”，不会改判为缺失或直属协调者。
          </Text>
        </Callout>
      ) : null}
      <Stack gap="xs">
        <Row justify="between" align="center" gap="sm">
          <Text muted size="xs">
            {'运行归属图 · ' +
              memberCount(rootPlan.members, rootPlan.memberTotal) +
              (rootPlan.members === rootPlan.memberTotal ? ' 个顶层 Worker' : ' 顶层')}
          </Text>
          {rootPlan.truncated ? (
            <Text muted size="xs">
              {rootPlan.shown + ' / ' + rootPlan.total + ' 节点'}
            </Text>
          ) : null}
        </Row>
        <MembershipGraph view={view} plan={rootPlan} selectedNode={node} />
        {rootPlan.rows.length === 0 ? (
          <Text muted size="xs">
            没有未记录父关系的顶层 Worker；其余记录见关系异常。
          </Text>
        ) : null}
        <Text muted size="xs">
          虚线＝运行归属（协调者 → 顶层 Worker）；实线＝已记录父 Worker；未记录的关系不推断。
        </Text>
        <Collapsible title="图例与说明" description="连线的边界与节点交互">
          <Stack gap="xs">
            <Text size="xs">
              运行归属不是父子关系，也不会推断 Worker 之间的归属；父节点缺失、无效、未读取或成环的 Worker 列在“关系异常”。
            </Text>
            <Text size="xs">
              观测过期只说明快照未更新，不改变任何节点状态。点击节点（或键盘回车/空格）查看完整记录；再次点击或按“收起详情”关闭。
            </Text>
          </Stack>
        </Collapsible>
        {rootPlan.truncated ? (
          <Text muted size="xs">
            图中仅显示前 {WORKER_ROW_LIMIT} 个 Worker（含嵌套节点），共 {rootPlan.total} 个。
          </Text>
        ) : null}
      </Stack>
      {topology.anomalies.length > 0 ? (
        <AnomalyGroup topology={topology} plan={anomalyPlan} selectedId={workerId} />
      ) : null}
      {topology.detachedTasks.length > 0 ? (
        <DetachedTasks tasks={topology.detachedTasks} />
      ) : null}
      {node === null ? null : shownIds.has(node.worker.id) ? null : (
        <Stack gap="sm">
          <Separator />
          <Text muted size="xs">
            该 Worker 不在当前显示的图中（可能被行数上限截断）。
          </Text>
          <SelectedDetail node={node} onClose={() => set(selectedWorkerId, '')} />
        </Stack>
      )}
    </Stack>
  )
}

function RunMeta({ view }: { view: RunView }) {
  const overviewItems = [
    { label: '运行 ID', value: view.id, code: true },
    { label: 'Orca Run ID', value: view.orcaRunId ?? '未记录', code: view.orcaRunId !== null },
    { label: '模式', value: MODE_LABEL[view.mode] },
    { label: '阶段', value: view.phase || '未记录' },
    { label: 'Schema', value: 'v' + view.schemaVersion },
    { label: '来源', value: SOURCE_LABEL[view.source] }
  ]
  return (
    <Stack gap="md">
      <Heading level={3}>运行元数据</Heading>
      <KeyValue items={overviewItems} />
      {view.summary ? <Text size="sm">{view.summary}</Text> : null}
      <Stack gap="xs">
        <TimeRow label="最近观测" at={view.lastObservedAt} />
        <TimeRow label="最近有效进展" at={view.lastEffectiveProgressAt} />
        <TimeRow label="开始" at={view.startedAt} />
        <TimeRow label="结束" at={view.endedAt} />
      </Stack>
    </Stack>
  )
}

function TasksSection({ view }: { view: RunView }) {
  const workerCounts = new Map<string, number>()
  for (const worker of view.workers) {
    const taskId = recordedTaskId(worker)
    if (taskId === null) continue
    workerCounts.set(taskId, (workerCounts.get(taskId) ?? 0) + 1)
  }
  const shown = view.tasks.slice(0, TASK_LIMIT)
  const rows = shown.map((task) => ({
    key: task.id,
    cells: {
      id: task.id,
      title: task.title,
      status: TASK_STATUS_LABEL[task.status],
      workers: workerCounts.get(task.id) ?? 0,
      orca: task.orcaTaskId ?? '—',
      dependencies: cleanText(task.dependencies.join(', ') || '—', 80),
      note: taskNote(task)
    }
  }))
  const counts = view.taskCounts
  return (
    <Stack gap="md">
      <Heading level={3}>任务</Heading>
      <Row gap="xs" wrap>
        <Badge tone="neutral">总数 {counts.total}</Badge>
        {counts.accepted > 0 ? <Badge tone="success">已验收 {counts.accepted}</Badge> : null}
        {counts.running > 0 ? <Badge tone="accent">运行中 {counts.running}</Badge> : null}
        {counts.blocked > 0 ? <Badge tone="warning">阻塞 {counts.blocked}</Badge> : null}
        {counts.waiting_user > 0 ? <Badge tone="warning">等待用户 {counts.waiting_user}</Badge> : null}
        {counts.rejected > 0 ? <Badge tone="danger">已打回 {counts.rejected}</Badge> : null}
        {counts.failed > 0 ? <Badge tone="danger">失败 {counts.failed}</Badge> : null}
        {counts.unknown > 0 ? <Badge tone="neutral">未知 {counts.unknown}</Badge> : null}
      </Row>
      {rows.length === 0 ? (
        <EmptyState title="没有任务记录" description="快照中没有 tasks。" icon="file-text" />
      ) : (
        <Table
          label="任务"
          columns={[
            { key: 'id', label: 'ID', width: 'sm' },
            { key: 'title', label: '标题', width: 'auto', minWidth: 'sm' },
            { key: 'status', label: '状态', width: 'sm' },
            { key: 'workers', label: 'Worker', width: 'xs', align: 'end' },
            { key: 'orca', label: 'Orca Task', width: 'md', hideBelow: 'md' },
            { key: 'dependencies', label: '依赖', width: 'md', hideBelow: 'md' },
            { key: 'note', label: '备注', width: 'lg', hideBelow: 'md' }
          ]}
          rows={rows}
          emptyText="没有任务记录"
        />
      )}
      {counts.total > TASK_LIMIT ? (
        <Text muted size="xs">
          仅显示前 {TASK_LIMIT} 个任务，共 {counts.total} 个。
        </Text>
      ) : null}
      <Text muted size="xs">
        “Worker”列是 task_id 指向该任务的 Worker 数；0 表示没有记录，不代表任务没有执行。状态不是独立验收。
      </Text>
    </Stack>
  )
}

function DeliverySection({ view }: { view: RunView }) {
  const summary = DELIVERY_FIELDS.map((field) => {
    const count = view.deliveryCounts[field]
    return {
      label: DELIVERY_LABEL[field],
      value: '是 ' + count.yes + ' · 否 ' + count.no + ' · 未核验 ' + count.unverified
    }
  })
  const shown = view.deliveries.slice(0, DELIVERY_LIMIT)
  const rows = shown.map((delivery) => ({
    key: delivery.taskId,
    cells: {
      task: delivery.taskId + (delivery.recorded ? '' : '（未记录）'),
      implemented: truthLabel(delivery.implemented),
      integrated: truthLabel(delivery.integrated),
      merged: truthLabel(delivery.merged),
      tracker: truthLabel(delivery.trackerClosed),
      evidence: delivery.evidenceCount
    }
  }))
  return (
    <Stack gap="md">
      <Heading level={3}>交付事实</Heading>
      <KeyValue items={summary} />
      <Text muted size="xs">
        只有严格 true/false 才是已核验；null 或缺失为未核验。没有 delivery 不代表成功。
      </Text>
      <Text muted size="xs">
        未记录交付的任务：{view.deliveryMissingTasks}（不等于成功）。
      </Text>
      {rows.length === 0 ? (
        <EmptyState title="没有交付记录" description="未记录不等于成功。" icon="package" />
      ) : (
        <Table
          label="交付"
          columns={[
            { key: 'task', label: '任务', width: 'auto', minWidth: 'sm' },
            { key: 'implemented', label: '已实施', width: 'sm' },
            { key: 'integrated', label: '已集成', width: 'sm', hideBelow: 'sm' },
            { key: 'merged', label: '已合并', width: 'sm' },
            { key: 'tracker', label: 'tracker', width: 'sm', hideBelow: 'md' },
            { key: 'evidence', label: '证据数', width: 'xs', align: 'end', hideBelow: 'md' }
          ]}
          rows={rows}
          emptyText="没有交付记录"
        />
      )}
      {view.deliveryTotal > DELIVERY_LIMIT ? (
        <Text muted size="xs">
          仅显示前 {DELIVERY_LIMIT} 条交付记录，共 {view.deliveryTotal} 条。
        </Text>
      ) : null}
      <Text muted size="xs">
        开 PR 不自动改变交付字段；false 表示已核验为否。证据引用不在这里渲染。
      </Text>
    </Stack>
  )
}

function ArtifactsSection({ view }: { view: RunView }) {
  const shown: ArtifactView[] = view.artifacts.slice(0, ARTIFACT_LIMIT)
  const rows = shown.map((artifact) => ({
    key: artifact.id,
    cells: {
      kind: artifact.kind,
      label: artifact.label,
      task: artifact.taskId ?? '—'
    }
  }))
  return (
    <Stack gap="md">
      <Heading level={3}>产物</Heading>
      {rows.length === 0 ? (
        <Text muted size="xs">
          没有记录产物引用。
        </Text>
      ) : (
        <Table
          label="产物"
          columns={[
            { key: 'kind', label: '类型', width: 'sm' },
            { key: 'label', label: '标签', width: 'auto', minWidth: 'sm' },
            { key: 'task', label: '任务', width: 'md', hideBelow: 'md' }
          ]}
          rows={rows}
          emptyText="没有记录产物引用"
        />
      )}
      {view.artifactTotal > ARTIFACT_LIMIT ? (
        <Text muted size="xs">
          仅显示前 {ARTIFACT_LIMIT} 个产物，共 {view.artifactTotal} 个。
        </Text>
      ) : null}
      <Text muted size="xs">
        仅显示产物标签，不渲染引用路径或文件内容。
      </Text>
    </Stack>
  )
}

function EventsSection({ view }: { view: RunView }) {
  const rows = view.events.map((event: EventView) => ({
    key: 'event-' + event.index,
    cells: {
      time: event.at === null ? '未知' : { type: 'relative' as const, at: event.at },
      type: event.type,
      source: event.source,
      bookkeeping: event.bookkeeping ? '是' : '否',
      summary: cleanText(event.summary || '—', 160)
    }
  }))
  return (
    <Collapsible
      title="最近事件"
      description={'共 ' + view.eventTotal + ' 条，显示最近 ' + view.events.length + ' 条'}
    >
      <Stack gap="md">
        {rows.length === 0 ? (
          <EmptyState title="没有事件记录" description="快照中没有 events。" icon="activity" />
        ) : (
          <Table
            label="事件"
            columns={[
              { key: 'time', label: '时间', width: 'sm' },
              { key: 'type', label: '类型', width: 'sm' },
              { key: 'source', label: '来源', width: 'sm', hideBelow: 'md' },
              { key: 'bookkeeping', label: '记账', width: 'xs', hideBelow: 'md' },
              { key: 'summary', label: '摘要', width: 'auto' }
            ]}
            rows={rows}
            emptyText="没有事件记录"
          />
        )}
        <Text muted size="xs">
          事件是记录摘要；heartbeat 不是有效进展。共 {view.eventTotal} 条，显示最近 {view.events.length} 条。
        </Text>
      </Stack>
    </Collapsible>
  )
}

function DetailsSection({ view }: { view: RunView }) {
  return (
    <Stack gap="md">
      <RunMeta view={view} />
      <Separator />
      <TasksSection view={view} />
      <Separator />
      <DeliverySection view={view} />
      <Separator />
      <ArtifactsSection view={view} />
      <Separator />
      <EventsSection view={view} />
    </Stack>
  )
}

function AttentionBlock({ view }: { view: RunView }) {
  if (view.attentionTotal === 0) {
    return (
      <Text muted size="xs">
        没有已记录的阻塞、待决或失败。
      </Text>
    )
  }
  return (
    <Collapsible
      title={'关注事项 · ' + view.attentionTotal}
      description="阻塞、待决、失败与失联"
      open={read(attentionOpen)}
      onChange={(value: boolean) => set(attentionOpen, value === true)}
    >
      <AttentionList view={view} />
    </Collapsible>
  )
}

function RunDetailsBlock({ view }: { view: RunView }) {
  return (
    <Collapsible
      title="运行详情"
      description="元数据、任务、交付、产物与事件"
      open={read(detailsOpen)}
      onChange={(value: boolean) => set(detailsOpen, value === true)}
    >
      <DetailsSection view={view} />
    </Collapsible>
  )
}

function Detail({ view }: { view: RunView }) {
  const topology = buildTopology(view)
  const selectedWorker = read(selectedWorkerId)
  return (
    <Stack gap="md">
      <TopologySection view={view} topology={topology} workerId={selectedWorker} />
      <Separator />
      <AttentionBlock view={view} />
      <RunDetailsBlock view={view} />
    </Stack>
  )
}

function RootProblems({ listing: value }: { listing: RunListing }) {
  if (value.rootProblems.length === 0) return null
  return (
    <Callout tone="warning" title="部分审计目录不可用">
      <Stack gap="xs">
        {value.rootProblems.map((problem) => (
          <Text key={problem.index} size="xs">
            第 {problem.index} 个目录：{problem.reason}
          </Text>
        ))}
      </Stack>
    </Callout>
  )
}

function RunSelector({ listing: value, selected }: { listing: RunListing; selected: string }) {
  return (
    <Select
      label="运行"
      labelHidden
      value={selected || undefined}
      placeholder="选择运行"
      options={value.runs.map((run) => ({ value: run.id, label: optionLabel(run) }))}
      onChange={(runId: string) => selectRun(runId)}
    />
  )
}

/** Only the exceptional states become badges; a healthy current run needs none. */
function runBadges(input: {
  mode: RunMode
  freshness: Freshness
  health: RunHealth
  availability: RunAvailability
}): ToneLabel[] {
  const badges: ToneLabel[] = []
  if (input.mode === 'DEMO') badges.push({ label: 'DEMO', tone: 'warning' })
  if (input.freshness !== 'current') {
    badges.push({
      label: '时效 ' + FRESHNESS_LABEL[input.freshness],
      tone: freshnessTone(input.freshness)
    })
  }
  if (input.health !== 'healthy' && input.health !== 'unknown') {
    badges.push({ label: '健康 ' + HEALTH_LABEL[input.health], tone: HEALTH_TONE[input.health] })
  }
  if (input.availability !== 'available') {
    badges.push({
      label: AVAILABILITY_LABEL[input.availability],
      tone: AVAILABILITY_TONE[input.availability]
    })
  }
  return badges
}

function RunHeader({
  view,
  summary,
  observedAt
}: {
  view: RunView | null
  summary: RunSummary | undefined
  observedAt: number | null
}) {
  const status = view?.status ?? summary?.status ?? 'unknown'
  const freshness = view?.freshness ?? 'unknown'
  const badges = runBadges({
    mode: view?.mode ?? summary?.mode ?? 'unknown',
    freshness,
    health: view?.health ?? summary?.health ?? 'unknown',
    availability: summary?.availability ?? 'available'
  })
  return (
    <Stack gap="xs">
      <Heading level={3}>{view?.title || summaryLabel(summary) || '未命名运行'}</Heading>
      <Row gap="xs" wrap align="center">
        <Text muted size="xs">
          {'运行 ' +
            RUN_STATUS_LABEL[status] +
            ' · ' +
            (view?.workerTotal ?? 0) +
            ' 个 Worker · ' +
            (view?.attentionTotal ?? 0) +
            ' 项需关注 · 观测'}
        </Text>
        {observedAt === null ? (
          <Text muted size="xs">
            未知
          </Text>
        ) : (
          <RelativeTime at={observedAt} muted />
        )}
        <ToneBadges items={badges} />
        {freshness === 'stale' ? (
          <Text muted size="xs">
            过期≠失败，也不代表没有进展
          </Text>
        ) : null}
      </Row>
    </Stack>
  )
}

export default function Panel() {
  const currentListing = read(listing)
  const currentError = read(listingError)
  const currentDetail = read(detail)
  const currentDetailError = read(detailError)
  const isLoading = read(loading)
  const isDetailLoading = read(detailLoading)
  const selected = read(selectedRunId)
  const selectedSummary = currentListing?.runs.find((run: RunSummary) => run.id === selected)
  const observedAt = currentDetail?.lastObservedAt ?? selectedSummary?.observedAt ?? null

  let content
  if (currentListing === null) {
    if (currentError !== null) {
      content = (
        <Callout tone="danger" title="无法读取运行">
          <Stack gap="sm">
            <Text size="sm">{currentError.message}</Text>
            <Row>
              <Button icon="refresh" onPress={() => void refresh()}>
                重试
              </Button>
            </Row>
          </Stack>
        </Callout>
      )
    } else {
      content = (
        <Stack gap="sm" align="center">
          <Spinner label="读取运行列表" />
          <Text muted size="xs">
            正在读取已配置的审计目录和 progress 注册表。
          </Text>
        </Stack>
      )
    }
  } else if (!currentListing.configured) {
    content = (
      <Callout tone="warning" title="未配置本地审计目录">
        <Stack gap="sm">
          <Text size="sm">
            在 Orca 的 Settings → Plugins → orchestra-auto 中，把“本地审计目录”设置为一个或多个绝对路径，每行一个。
          </Text>
          <Text muted size="xs">
            插件只读取这些目录下的 progress.json；路径中不要有符号链接。留空则不会读取任何运行。
          </Text>
          <Row>
            <Button icon="refresh" onPress={() => void refresh()}>
              重新读取
            </Button>
          </Row>
        </Stack>
      </Callout>
    )
  } else {
    content = (
      <Stack gap="md">
        {currentError !== null ? (
          <Callout tone="danger" title="刷新失败">
            <Stack gap="xs">
              <Text size="sm">{currentError.message}</Text>
              <Text muted size="xs">
                以下为上次成功读取的内容；数据可能已经变化。
              </Text>
              <Row>
                <Button icon="refresh" onPress={() => void refresh()}>
                  重试
                </Button>
              </Row>
            </Stack>
          </Callout>
        ) : null}
        <RootProblems listing={currentListing} />
        {currentListing.warnings.length > 0 ? (
          <Collapsible
            title={'读取提示 · ' + currentListing.warnings.length}
            description="注册表与审计目录的读取提示"
          >
            <WarningLines lines={currentListing.warnings} />
          </Collapsible>
        ) : null}
        {currentListing.runs.length === 0 ? (
          <EmptyState
            title="没有可读运行"
            description="没有找到 progress.json。启动一个 orchestra-auto 运行，或在设置中增加审计目录。"
            icon="folder"
          />
        ) : (
          <Stack gap="md">
            <RunSelector listing={currentListing} selected={selected} />
            <RunHeader view={currentDetail} summary={selectedSummary} observedAt={observedAt} />
            {currentDetail?.mode === 'DEMO' ? (
              <Text size="xs" tone="warning">
                DEMO 示例数据，不代表真实执行或验收。
              </Text>
            ) : null}
            {currentDetail && currentDetail.warnings.length > 0 ? (
              <Collapsible
                title={'快照提示 · ' + currentDetail.warnings.length}
                description="记录在 progress.json 中的读取提示"
              >
                <WarningLines lines={currentDetail.warnings} />
              </Collapsible>
            ) : null}
            {isDetailLoading && currentDetail !== null ? (
              <Row gap="xs" align="center">
                <Spinner label="刷新运行快照" />
                <Text muted size="xs">
                  正在刷新当前运行。
                </Text>
              </Row>
            ) : null}
            {currentDetailError !== null ? (
              <Callout tone="danger" title={errorTitle(currentDetailError)}>
                <Stack gap="sm">
                  <Text size="sm">{currentDetailError.message}</Text>
                  {selected ? (
                    <Row>
                      <Button icon="refresh" onPress={() => selectRun(selected)}>
                        重试该运行
                      </Button>
                    </Row>
                  ) : null}
                </Stack>
              </Callout>
            ) : null}
            {currentDetail !== null ? <Detail view={currentDetail} /> : null}
            {currentDetail === null && currentDetailError === null && !isDetailLoading ? (
              <EmptyState
                title="选择一个运行"
                description="从上方列表选择一个运行以读取协调者与 Worker 的拓扑。"
                icon="activity"
              />
            ) : null}
          </Stack>
        )}
      </Stack>
    )
  }

  return (
    <Stack gap="md">
      <Row justify="between" align="start">
        <Stack gap="xs">
          <Heading level={2}>orchestra-auto</Heading>
          <Text muted size="xs">
            只读观测 · 以协调者与 Worker 拓扑为核心 · 不执行编排
          </Text>
        </Stack>
        <Row gap="xs" align="center">
          {isLoading ? <Badge tone="accent">读取中</Badge> : null}
          <IconButton
            icon="refresh"
            label="刷新"
            tooltip="刷新运行列表和当前快照"
            size="sm"
            variant="ghost"
            disabled={isLoading}
            onPress={() => void refresh()}
          />
        </Row>
      </Row>
      {content}
      <Separator />
      <Text muted size="xs">
        数据来自 progress.json 与 progress 注册表；拓扑只使用已记录的 parent_worker_id 与 task_id，不推断未记录关系。缺失、损坏、不可用和过期状态会明确标出。
      </Text>
    </Stack>
  )
}
