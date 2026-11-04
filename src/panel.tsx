// Read-only observatory panel for orchestra-auto runs.
//
// The default view is the recorded topology: the run as coordinator, workers
// linked only by parent_worker_id, their task association, status and recorded
// attention. Missing, invalid, cyclic and truncated relations stay explicit.
// Secondary facts live behind the "细节" tab; nothing is written or executed.
import {
  Badge,
  Button,
  Callout,
  Collapsible,
  EmptyState,
  Heading,
  IconButton,
  KeyValue,
  read,
  RelativeTime,
  Row,
  Select,
  Separator,
  set,
  Spinner,
  Stack,
  Table,
  Tab,
  Tabs,
  Text
} from 'orca'
import {
  DELIVERY_FIELDS,
  STALE_SECONDS,
  cleanText,
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
  detail,
  detailError,
  detailLoading,
  listing,
  listingError,
  loading,
  refresh,
  selectRun,
  selectedRunId,
  selectedTab,
  selectedWorkerId
} from './panel-state'

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export { setup } from './panel-state'

const TASK_LIMIT = 100
const DELIVERY_LIMIT = 100
const ARTIFACT_LIMIT = 50
const WARNING_LIMIT = 6
const ATTENTION_LIMIT = 10
const DETACHED_TASK_LIMIT = 50
const WORKER_ROW_LIMIT = 100

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

const MODE_TONE: Record<RunMode, Tone> = {
  REAL: 'accent',
  DEMO: 'warning',
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

const RELATION_TONE: Record<WorkerRelation, Tone> = {
  root: 'neutral',
  child: 'neutral',
  'missing-parent': 'warning',
  'invalid-parent': 'warning',
  'unresolved-parent': 'warning',
  cycle: 'danger',
  'depth-limit': 'warning'
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

function relationBadge(node: TopologyWorker): string {
  switch (node.relation) {
    case 'root':
      return '直接隶属'
    case 'child':
      return '父子关系已记录'
    case 'missing-parent':
      return '父节点缺失'
    case 'invalid-parent':
      return '父关系无效'
    case 'unresolved-parent':
      return '父节点未读取'
    case 'cycle':
      return '父关系成环'
    case 'depth-limit':
      return '层级过深'
  }
}

function workerTaskText(node: TopologyWorker): string {
  if (node.task) return node.task.title
  if (node.worker.taskState === 'recorded' && node.worker.taskId !== null) {
    return node.worker.taskId + '（未记录于 tasks）'
  }
  if (node.worker.taskState === 'invalid') return '任务记录无效'
  return '未记录'
}

function relationText(node: TopologyWorker): string {
  const parent = node.parentId ?? '未记录'
  switch (node.relation) {
    case 'root':
      return '直接隶属协调者（未记录父 Worker）'
    case 'child':
      return '父 Worker ' + parent
    case 'missing-parent':
      return '父 ' + parent + ' 未记录'
    case 'invalid-parent':
      return '父 Worker 记录无效'
    case 'unresolved-parent':
      return '父 ' + parent + ' 不在已读取的 Worker 中（可能因投影上限）'
    case 'cycle':
      return '父关系成环（父 ' + parent + '）'
    case 'depth-limit':
      return '层级过深，未继续缩进（父 ' + parent + '）'
  }
}

function relationLine(node: TopologyWorker, depth: number): string {
  if (depth > 0 || node.relation === 'child') return '父 ' + (node.parentId ?? '未记录')
  if (node.relation === 'root') return ''
  return relationText(node)
}

function lifecycleTone(lifecycle: WorkerLifecycle): Tone {
  switch (lifecycle) {
    case 'running':
      return 'accent'
    case 'waiting_user':
      return 'warning'
    case 'failed':
    case 'lost':
      return 'danger'
    default:
      return 'neutral'
  }
}

type TopologyRow = { node: TopologyWorker; depth: number }

function flattenRows(nodes: TopologyWorker[], depth: number, output: TopologyRow[]): void {
  for (const node of nodes) {
    output.push({ node, depth })
    flattenRows(node.children, depth + 1, output)
  }
}

function AttentionSection({ view }: { view: RunView }) {
  return (
    <Stack gap="xs">
      <Heading level={3}>需要关注</Heading>
      {view.attention.length === 0 ? (
        <Text muted size="xs">
          没有已记录的阻塞、待决或失败。
        </Text>
      ) : (
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
      )}
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
    { label: '核验生命周期', value: LIFECYCLE_LABEL[node.worker.lifecycle] },
    { label: '自报生命周期', value: LIFECYCLE_LABEL[node.worker.reportedLifecycle] },
    { label: '启动确认', value: START_LABEL[node.worker.startConfirmation] },
    { label: '时效', value: FRESHNESS_LABEL[node.worker.freshness] },
    { label: '工作区', value: node.worker.worktree || '未记录' },
    { label: '自报摘要', value: node.worker.reportedSummary || '未记录' }
  ]
  return (
    <Stack gap="sm">
      <Heading level={3}>Worker 详情</Heading>
      <Row gap="xs" wrap>
        <Badge tone={RELATION_TONE[node.relation]}>{relationBadge(node)}</Badge>
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

function WorkerRow({
  row,
  selected
}: {
  row: TopologyRow
  selected: boolean
}) {
  const node = row.node
  const indentation =
    row.depth > 0 ? '↳'.repeat(Math.min(row.depth, 4)) + (row.depth > 4 ? '…' : '') : ''
  const task = '任务：' + workerTaskText(node)
  const relation = relationLine(node, row.depth)
  return (
    <Stack gap="xs">
      <Row gap="xs" wrap align="center">
        {indentation ? (
          <Text muted size="xs">
            {indentation}
          </Text>
        ) : null}
        <Button
          size="sm"
          variant={selected ? 'solid' : 'ghost'}
          tooltip={'选择 ' + node.worker.id + ' 查看详情'}
          onPress={() => set(selectedWorkerId, selected ? '' : node.worker.id)}
        >
          {cleanText(node.worker.id, 40)}
        </Button>
        <Badge tone={lifecycleTone(node.worker.lifecycle)}>
          {LIFECYCLE_LABEL[node.worker.lifecycle]}
        </Badge>
        {node.attention.length > 0 ? (
          <Badge tone="warning">需关注 {node.attention.length}</Badge>
        ) : null}
        {node.worker.freshness === 'stale' ? <Badge tone="warning">过期</Badge> : null}
        {node.worker.startConfirmation === 'unobserved' ? (
          <Badge tone="warning">启动未观察</Badge>
        ) : null}
      </Row>
      <Text size="xs">
        {task}
        {relation ? ' · ' + relation : ''}
      </Text>
    </Stack>
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
            description="快照的 workers 为空；这不代表没有执行。任务记录见“细节”。"
            icon="agent"
          />
        )}
      </Stack>
    )
  }

  const rootRows: TopologyRow[] = []
  const anomalyRows: TopologyRow[] = []
  flattenRows(topology.roots, 0, rootRows)
  flattenRows(topology.anomalies, 0, anomalyRows)
  const rootShown = rootRows.slice(0, WORKER_ROW_LIMIT)
  const anomalyShown = anomalyRows.slice(0, WORKER_ROW_LIMIT)
  const detachedShown = topology.detachedTasks.slice(0, DETACHED_TASK_LIMIT)
  const node = workerId ? topologyNode(topology, workerId) : null
  const shownWorkerIds = new Set(
    [...rootShown, ...anomalyShown].map((row) => row.node.worker.id)
  )
  const renderRows = (rows: TopologyRow[]) =>
    rows.map((row) => (
      <Stack key={'worker:' + row.node.worker.id} gap="sm">
        <WorkerRow
          row={row}
          selected={row.node.worker.id === workerId}
        />
        {row.node.worker.id === workerId ? <WorkerDetail node={row.node} /> : null}
      </Stack>
    ))

  return (
    <Stack gap="md">
      <Row gap="xs" wrap>
        <Badge tone="neutral">Worker {view.workerTotal}</Badge>
        {view.attentionTotal > 0 ? <Badge tone="warning">需关注 {view.attentionTotal}</Badge> : null}
        {topology.counts.anomalies > 0 ? (
          <Badge tone="danger">关系异常 {topology.counts.anomalies}</Badge>
        ) : null}
        {topology.counts.unrecordedTasks > 0 ? (
          <Badge tone="warning">未记录任务 {topology.counts.unrecordedTasks}</Badge>
        ) : null}
        {topology.detachedTasks.length > 0 ? (
          <Badge tone="neutral">未关联任务 {topology.detachedTasks.length}</Badge>
        ) : null}
      </Row>
      {topology.projectionTruncated ? (
        <Callout tone="warning" title="Worker 投影已截断">
          <Text size="xs">
            快照记录了 {view.workerTotal} 个 Worker，这里只读取了前 {view.workers.length} 个；父节点位于未读取部分时显示为“不在已读取的 Worker 中”，不会改判为缺失或直属协调者。
          </Text>
        </Callout>
      ) : null}
      <Stack gap="xs">
        <Heading level={3}>协调者 · 本运行</Heading>
        <Text muted size="xs">
          {'运行状态 ' +
            RUN_STATUS_LABEL[view.status] +
            ' · 快照记录 ' +
            view.workerTotal +
            ' 个 Worker · ' +
            view.attentionTotal +
            ' 项需关注' +
            (topology.counts.anomalies > 0
              ? ' · ' + topology.counts.anomalies + ' 个关系异常'
              : '')}
        </Text>
        <Text muted size="xs">
          未记录 parent_worker_id 的 Worker 直接列在这里；缩进和“父 …”只来自已记录字段。
        </Text>
        {rootRows.length > WORKER_ROW_LIMIT ||
        anomalyRows.length > WORKER_ROW_LIMIT ||
        topology.detachedTasks.length > DETACHED_TASK_LIMIT ? (
          <Text muted size="xs">
            为保持可读，下面最多显示 {WORKER_ROW_LIMIT} 个直属 Worker、{WORKER_ROW_LIMIT}{' '}
            个关系异常 Worker 和 {DETACHED_TASK_LIMIT} 个未关联任务；真实总数见各组标题。
          </Text>
        ) : null}
      </Stack>
      {rootRows.length > WORKER_ROW_LIMIT ? (
        <Text muted size="xs">
          直属 Worker 仅显示前 {WORKER_ROW_LIMIT} 个，共 {rootRows.length} 个。
        </Text>
      ) : null}
      {rootShown.length > 0 ? <Stack gap="sm">{renderRows(rootShown)}</Stack> : null}
      {anomalyRows.length > 0 ? (
        <Stack gap="sm">
          <Separator />
          <Heading level={3}>关系异常 · {anomalyRows.length}</Heading>
          <Text muted size="xs">
            父节点缺失、未知或成环；不会并入协调者。
            {topology.depthLimited > 0
              ? ' 其中 ' + topology.depthLimited + ' 个因层级过深而平铺。'
              : ''}
          </Text>
          {anomalyRows.length > WORKER_ROW_LIMIT ? (
            <Text muted size="xs">
              异常 Worker 仅显示前 {WORKER_ROW_LIMIT} 个，共 {anomalyRows.length} 个。
            </Text>
          ) : null}
          {renderRows(anomalyShown)}
        </Stack>
      ) : null}
      {topology.detachedTasks.length > 0 ? (
        <Stack gap="sm">
          <Separator />
          <Heading level={3}>未关联 Worker 的任务 · {topology.detachedTasks.length}</Heading>
          <Text muted size="xs">
            这些任务没有 Worker 的 task_id 指向它们；未关联不代表没有执行。
          </Text>
          {topology.detachedTasks.length > DETACHED_TASK_LIMIT ? (
            <Text muted size="xs">
              未关联任务仅显示前 {DETACHED_TASK_LIMIT} 个，共 {topology.detachedTasks.length} 个。
            </Text>
          ) : null}
          {detachedShown.map((task) => (
            <Stack key={'task:' + task.id} gap="xs">
              <Text size="sm">{task.id}</Text>
              <Text size="xs">
                {cleanText(task.title, 160)} · 状态 {TASK_STATUS_LABEL[task.status]}
                {task.dependencies.length > 0 ? ' · 依赖 ' + task.dependencies.join(', ') : ''}
              </Text>
            </Stack>
          ))}
        </Stack>
      ) : null}
      {node && !shownWorkerIds.has(node.worker.id) ? (
        <Stack gap="sm">
          <Separator />
          <Text muted size="xs">
            该 Worker 不在当前显示的行中（可能被行数上限截断）。
          </Text>
          <WorkerDetail node={node} />
        </Stack>
      ) : null}
      {node === null ? (
        <Text muted size="xs">
          选择拓扑中的一个 Worker 查看任务、生命周期与自报细节。
        </Text>
      ) : null}
      <Text muted size="xs">
        父子关系只来自 parent_worker_id；未记录父 Worker 的显示为直接隶属协调者，父节点缺失、无效、成环或超出读取上限时不会推断归属。
      </Text>
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
    if (worker.taskState !== 'recorded' || worker.taskId === null) continue
    workerCounts.set(worker.taskId, (workerCounts.get(worker.taskId) ?? 0) + 1)
  }
  const shown = view.tasks.slice(0, TASK_LIMIT)
  const rows = shown.map((task) => ({
    key: task.id,
    cells: {
      id: task.id,
      title: task.title,
      status: TASK_STATUS_LABEL[task.status],
      workers: workerCounts.get(task.id) ?? 0,
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

function Detail({ view }: { view: RunView }) {
  const rawTab = read(selectedTab)
  const activeTab = rawTab === 'details' ? 'details' : 'topology'
  const topology = buildTopology(view)
  const selectedWorker = read(selectedWorkerId)
  return (
    <Stack gap="md">
      <AttentionSection view={view} />
      <Tabs
        label="运行详情"
        value={activeTab}
        onChange={(value) => set(selectedTab, value === 'details' ? 'details' : 'topology')}
      >
        <Tab value="topology" label="拓扑">
          <TopologySection view={view} topology={topology} workerId={selectedWorker} />
        </Tab>
        <Tab value="details" label="细节">
          <DetailsSection view={view} />
        </Tab>
      </Tabs>
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
      onChange={(runId) => selectRun(runId)}
    />
  )
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
  const health = view?.health ?? summary?.health ?? 'unknown'
  const mode = view?.mode ?? summary?.mode ?? 'unknown'
  const freshness = view?.freshness ?? 'unknown'
  return (
    <Stack gap="xs">
      <Heading level={3}>{view?.title || summaryLabel(summary) || '未命名运行'}</Heading>
      <Row gap="xs" wrap align="center">
        <Badge tone={MODE_TONE[mode]}>{MODE_LABEL[mode]}</Badge>
        <Badge tone={RUN_STATUS_TONE[status]}>{RUN_STATUS_LABEL[status]}</Badge>
        <Badge tone={HEALTH_TONE[health]}>健康 {HEALTH_LABEL[health]}</Badge>
        <Badge tone={freshnessTone(freshness)}>时效 {FRESHNESS_LABEL[freshness]}</Badge>
        {summary && summary.availability !== 'available' ? (
          <Badge tone={AVAILABILITY_TONE[summary.availability]}>
            {AVAILABILITY_LABEL[summary.availability]}
          </Badge>
        ) : null}
      </Row>
      <TimeRow label="最近观测" at={observedAt} />
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
  const selectedSummary = currentListing?.runs.find((run) => run.id === selected)
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
          <Callout tone="warning" title="读取提示">
            <WarningLines lines={currentListing.warnings} />
          </Callout>
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
              <Callout tone="warning" title="DEMO 数据">
                <Text size="xs">该运行标记为 DEMO；示例数据不代表真实执行或验收。</Text>
              </Callout>
            ) : null}
            {currentDetail?.freshness === 'stale' ? (
              <Callout tone="warning" title="观测已过期">
                <Text size="xs">
                  最近观测已超过 {Math.round(STALE_SECONDS / 60)} 分钟；过期不等于失败，也不代表没有进展。
                </Text>
              </Callout>
            ) : null}
            {currentDetail?.health === 'degraded' ||
            currentDetail?.health === 'blocked' ||
            currentDetail?.health === 'lost' ? (
              <Callout
                tone={currentDetail.health === 'lost' ? 'danger' : 'warning'}
                title="运行健康"
              >
                <Text size="xs">记录的健康状态：{HEALTH_LABEL[currentDetail.health]}。</Text>
              </Callout>
            ) : null}
            {currentDetail && currentDetail.warnings.length > 0 ? (
              <Callout tone="warning" title="快照提示">
                <WarningLines lines={currentDetail.warnings} />
              </Callout>
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
