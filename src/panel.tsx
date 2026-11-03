// Read-only observatory panel for orchestra-auto runs.
//
// The panel never writes run state and never calls an orchestration action. It
// asks its own worker for a listing and one projected snapshot, then renders
// only recorded facts. Missing, stale, corrupt and unavailable states are
// rendered as such; a missing delivery is never shown as success.
import {
  atom,
  Badge,
  Button,
  Callout,
  Collapsible,
  EmptyState,
  Heading,
  IconButton,
  KeyValue,
  plugin,
  read,
  RelativeTime,
  Row,
  Select,
  Separator,
  set,
  settings,
  Spinner,
  Stack,
  Table,
  Tab,
  Tabs,
  Text,
  type PanelContext
} from 'orca'
import {
  DELIVERY_FIELDS,
  STALE_SECONDS,
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

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
type PanelError = { code: string; message: string }

const TASK_LIMIT = 100
const WORKER_LIMIT = 100
const DELIVERY_LIMIT = 100
const ARTIFACT_LIMIT = 50
const WARNING_LIMIT = 6
const ATTENTION_LIMIT = 20

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

const ERROR_TEXT: Record<string, string> = {
  configuration_missing: '未配置审计目录',
  audit_roots_invalid: '没有可用的审计目录',
  invalid_params: '请求参数无效',
  invalid_run_id: '运行 ID 无效',
  run_not_found: '这个运行已不存在',
  run_unavailable: '该运行不可用',
  run_corrupt: '该运行的 progress.json 损坏或不受支持',
  read_failed: '读取运行数据失败',
  timeout: '读取超时',
  unavailable: 'worker 尚未启动或不可用',
  unknown_method: 'worker 不支持该请求',
  capability_denied: '缺少读取设置的权限',
  consent_required: '插件尚未获得授权',
  not_permitted: '当前上下文不允许读取',
  action_failed: '读取失败'
}

const listing = atom<RunListing | null>(null)
const listingError = atom<PanelError | null>(null)
const detail = atom<RunView | null>(null)
const detailError = atom<PanelError | null>(null)
const loading = atom(false)
const detailLoading = atom(false)
const selectedRunId = atom('selectedRunId', '', { persist: 'plugin' })
const selectedTab = atom('selectedTab', 'overview', { persist: 'plugin' })

let generation = 0

function panelError(error: unknown): PanelError {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string') {
      if (code === 'run_unavailable' || code === 'run_corrupt') {
        const message = (error as { message?: unknown }).message
        if (typeof message === 'string' && message.length > 0 && message.length <= 200) {
          return { code, message }
        }
      }
      return { code, message: ERROR_TEXT[code] ?? ERROR_TEXT.action_failed }
    }
  }
  return { code: 'action_failed', message: ERROR_TEXT.action_failed }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return value.slice(0, max - 1) + '…'
}

function runStatusTone(status: RunStatus): Tone {
  if (status === 'active') return 'accent'
  if (status === 'waiting_user' || status === 'paused') return 'warning'
  if (status === 'failed') return 'danger'
  // A completed status is recorded state, not a claim that every delivery is verified.
  return 'neutral'
}

function healthTone(health: RunHealth): Tone {
  if (health === 'healthy') return 'success'
  if (health === 'lost') return 'danger'
  if (health === 'degraded' || health === 'blocked') return 'warning'
  return 'neutral'
}

function freshnessTone(freshness: Freshness): Tone {
  return freshness === 'stale' ? 'warning' : 'neutral'
}

function modeTone(mode: RunMode): Tone {
  if (mode === 'DEMO') return 'warning'
  if (mode === 'REAL') return 'accent'
  return 'neutral'
}

function taskTone(status: TaskStatus): Tone {
  if (status === 'accepted') return 'success'
  if (status === 'running') return 'accent'
  if (status === 'blocked' || status === 'waiting_user') return 'warning'
  if (status === 'failed' || status === 'rejected') return 'danger'
  return 'neutral'
}

function availabilityTone(availability: RunAvailability): Tone {
  if (availability === 'corrupt') return 'danger'
  if (availability === 'unavailable') return 'warning'
  return 'neutral'
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
  return truncate(notes.join('；') || '—', 180)
}

function optionLabel(run: RunSummary): string {
  const suffix = run.availability === 'available' ? '' : ' · ' + AVAILABILITY_LABEL[run.availability]
  return truncate(RUN_STATUS_LABEL[run.status] + ' · ' + run.label + suffix, 100)
}

function summaryLabel(run: RunSummary | undefined): string {
  if (!run) return ''
  return run.label || run.id
}

function errorTitle(error: PanelError): string {
  if (error.code === 'run_corrupt') return '快照损坏'
  if (error.code === 'run_unavailable') return '运行不可用'
  if (error.code === 'run_not_found') return '运行不存在'
  if (error.code === 'timeout') return '读取超时'
  return '读取失败'
}

function deliveryFieldLabel(field: DeliveryField): string {
  if (field === 'implemented') return '已实施'
  if (field === 'integrated') return '已集成'
  if (field === 'merged') return '已合并'
  return 'tracker 关闭'
}

async function loadRun(runId: string, current: number): Promise<void> {
  set(detailLoading, true)
  set(detailError, null)
  try {
    const view = await plugin.request('run.get', { runId })
    if (current !== generation) return
    set(detail, view)
  } catch (error) {
    if (current !== generation) return
    set(detail, null)
    set(detailError, panelError(error))
  } finally {
    if (current === generation) set(detailLoading, false)
  }
}

async function refresh(preferredId?: string): Promise<void> {
  const current = ++generation
  set(loading, true)
  set(detailLoading, false)
  set(listingError, null)
  try {
    const next = await plugin.request('runs.list')
    if (current !== generation) return
    set(listing, next)
    const wanted = preferredId ?? read(selectedRunId)
    const selected = next.runs.find((run) => run.id === wanted) ?? next.runs[0]
    if (!selected) {
      set(selectedRunId, '')
      set(detail, null)
      set(detailError, null)
      return
    }
    if (selected.id !== read(selectedRunId)) {
      set(detail, null)
      set(detailError, null)
    }
    set(selectedRunId, selected.id)
    await loadRun(selected.id, current)
  } catch (error) {
    if (current !== generation) return
    set(listingError, panelError(error))
    set(detailLoading, false)
  } finally {
    if (current === generation) {
      set(loading, false)
      set(detailLoading, false)
    }
  }
}

function selectRun(runId: string): void {
  const current = ++generation
  set(loading, false)
  set(selectedRunId, runId)
  set(detail, null)
  set(detailError, null)
  void loadRun(runId, current)
}

/** Runs once before the first render; requests end with the panel. */
export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(
    settings.onDidChange(() => {
      void refresh()
    })
  )
  void refresh()
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

function Overview({ view }: { view: RunView }) {
  const overviewItems = [
    { label: '运行 ID', value: view.id, code: true },
    { label: 'Orca Run ID', value: view.orcaRunId ?? '未记录', code: view.orcaRunId !== null },
    { label: '模式', value: MODE_LABEL[view.mode] },
    { label: '阶段', value: view.phase || '未记录' },
    { label: 'Schema', value: 'v' + view.schemaVersion },
    { label: '来源', value: SOURCE_LABEL[view.source] }
  ]
  const deliveryItems = DELIVERY_FIELDS.map((field) => {
    const count = view.deliveryCounts[field]
    return {
      label: deliveryFieldLabel(field),
      value: '是 ' + count.yes + ' · 否 ' + count.no + ' · 未核验 ' + count.unverified
    }
  })
  return (
    <Stack gap="md">
      {view.mode === 'DEMO' ? (
        <Callout tone="warning" title="DEMO 数据">
          <Text size="xs">该运行标记为 DEMO；示例数据不代表真实执行或验收。</Text>
        </Callout>
      ) : null}
      <KeyValue items={overviewItems} />
      {view.summary ? <Text size="sm">{view.summary}</Text> : null}
      <Stack gap="xs">
        <TimeRow label="最近观测" at={view.lastObservedAt} />
        <TimeRow label="最近有效进展" at={view.lastEffectiveProgressAt} />
        <TimeRow label="开始" at={view.startedAt} />
        <TimeRow label="结束" at={view.endedAt} />
      </Stack>
      {view.freshness === 'stale' ? (
        <Callout tone="warning" title="观测已过期">
          <Text size="xs">
            最近观测已超过 {Math.round(STALE_SECONDS / 60)} 分钟；过期不等于失败。
          </Text>
        </Callout>
      ) : null}
      {view.health === 'degraded' || view.health === 'blocked' || view.health === 'lost' ? (
        <Callout tone={view.health === 'lost' ? 'danger' : 'warning'} title="运行健康">
          <Text size="xs">记录的健康状态：{HEALTH_LABEL[view.health]}。</Text>
        </Callout>
      ) : null}
      {view.warnings.length > 0 ? (
        <Callout tone="warning" title="快照提示">
          <WarningLines lines={view.warnings} />
        </Callout>
      ) : null}
      <Separator />
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
      <Separator />
      <Heading level={3}>交付事实</Heading>
      <KeyValue items={deliveryItems} />
      <Text muted size="xs">
        只有严格 true/false 才是已核验；null 或缺失为未核验。没有 delivery 不代表成功。
      </Text>
      <Text muted size="xs">
        未记录交付的任务：{view.deliveryMissingTasks}（不等于成功）。
      </Text>
      <Collapsible
        title="最近事件"
        description={'共 ' + view.eventTotal + ' 条，显示最近 ' + view.events.length + ' 条'}
      >
        <Events view={view} />
      </Collapsible>
    </Stack>
  )
}

function Tasks({ view }: { view: RunView }) {
  const shown = view.tasks.slice(0, TASK_LIMIT)
  const rows = shown.map((task) => ({
    key: task.id,
    cells: {
      id: task.id,
      title: task.title,
      status: TASK_STATUS_LABEL[task.status],
      dependencies: truncate(task.dependencies.join(', ') || '—', 80),
      orca: task.orcaTaskId ?? '—',
      note: taskNote(task)
    }
  }))
  const counts = view.taskCounts
  return (
    <Stack gap="md">
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
            { key: 'id', label: 'ID', width: 'md' },
            { key: 'title', label: '标题', width: 'auto' },
            { key: 'status', label: '状态', width: 'sm' },
            { key: 'dependencies', label: '依赖', width: 'md', hideBelow: 'md' },
            { key: 'orca', label: 'Orca Task', width: 'md', hideBelow: 'md' },
            { key: 'note', label: '备注', width: 'lg', hideBelow: 'md' }
          ]}
          rows={rows}
          emptyText="没有任务记录"
        />
      )}
      {view.taskCounts.total > TASK_LIMIT ? (
        <Text muted size="xs">
          仅显示前 {TASK_LIMIT} 个任务，共 {view.taskCounts.total} 个。
        </Text>
      ) : null}
      <Text muted size="xs">
        状态是协调者记录的事实，不是独立验收；缺失或无法识别的状态显示为未知。
      </Text>
    </Stack>
  )
}

function Workers({ view }: { view: RunView }) {
  const shown = view.workers.slice(0, WORKER_LIMIT)
  const rows = shown.map((worker) => ({
    key: worker.id,
    cells: {
      worker: worker.id,
      task: worker.taskId ?? '未知',
      dispatch: worker.dispatchId ?? '—',
      parent: worker.parentWorkerId ?? '—',
      attempt: worker.attempt ?? '未知',
      lifecycle: LIFECYCLE_LABEL[worker.lifecycle],
      reported: LIFECYCLE_LABEL[worker.reportedLifecycle],
      start: START_LABEL[worker.startConfirmation],
      freshness: FRESHNESS_LABEL[worker.freshness],
      worktree: worker.worktree || '未记录',
      report: truncate(worker.reportedSummary || '—', 120)
    }
  }))
  return (
    <Stack gap="md">
      {rows.length === 0 ? (
        <EmptyState title="没有 Worker 记录" description="快照中没有 workers。" icon="agent" />
      ) : (
        <Table
          label="Worker"
          columns={[
            { key: 'worker', label: 'Worker', width: 'md' },
            { key: 'task', label: '任务', width: 'md' },
            { key: 'dispatch', label: 'Dispatch', width: 'md', hideBelow: 'md' },
            { key: 'parent', label: '父 Worker', width: 'md', hideBelow: 'md' },
            { key: 'attempt', label: '次数', width: 'xs', align: 'end', hideBelow: 'md' },
            { key: 'lifecycle', label: '核验生命周期', width: 'sm' },
            { key: 'reported', label: '自报生命周期', width: 'sm', hideBelow: 'sm' },
            { key: 'start', label: '启动确认', width: 'sm', hideBelow: 'md' },
            { key: 'freshness', label: '时效', width: 'sm', hideBelow: 'md' },
            { key: 'worktree', label: '工作区（基名）', width: 'md', hideBelow: 'md' },
            { key: 'report', label: '自报摘要', width: 'lg', hideBelow: 'md' }
          ]}
          rows={rows}
          emptyText="没有 Worker 记录"
        />
      )}
      {view.workerTotal > WORKER_LIMIT ? (
        <Text muted size="xs">
          仅显示前 {WORKER_LIMIT} 个 Worker，共 {view.workerTotal} 个。
        </Text>
      ) : null}
      <Text muted size="xs">
        自报不等于验收；启动确认 observed 才表示观察到启动，unknown 与 unobserved 不同。
      </Text>
    </Stack>
  )
}

function DeliveryTable({ view }: { view: RunView }) {
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
      <Text muted size="xs">
        证据引用不在此渲染；这里只显示交付事实与引用数量。
      </Text>
      {rows.length === 0 ? (
        <EmptyState title="没有交付记录" description="未记录不等于成功。" icon="package" />
      ) : (
        <Table
          label="交付"
          columns={[
            { key: 'task', label: '任务', width: 'auto', minWidth: 'md' },
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
        开 PR 不自动改变交付字段；未记录或 null 为未核验，false 表示已核验为否。
      </Text>
    </Stack>
  )
}

function Artifacts({ view }: { view: RunView }) {
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
      {rows.length === 0 ? (
        <Text muted size="xs">
          没有记录产物引用。
        </Text>
      ) : (
        <Table
          label="产物"
          columns={[
            { key: 'kind', label: '类型', width: 'sm' },
            { key: 'label', label: '标签', width: 'auto' },
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

function Events({ view }: { view: RunView }) {
  const rows = view.events.map((event: EventView) => ({
    key: 'event-' + event.index,
    cells: {
      time: event.at === null ? '未知' : { type: 'relative' as const, at: event.at },
      type: event.type,
      source: event.source,
      bookkeeping: event.bookkeeping ? '是' : '否',
      summary: truncate(event.summary || '—', 160)
    }
  }))
  return (
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
  )
}

function Detail({ view }: { view: RunView }) {
  const rawTab = read(selectedTab)
  const activeTab = ['overview', 'tasks', 'workers', 'deliveries'].includes(rawTab)
    ? rawTab
    : 'overview'
  return (
    <Stack gap="md">
      <Tabs label="运行详情" value={activeTab} onChange={(value) => set(selectedTab, value)}>
        <Tab value="overview" label="概览">
          <Overview view={view} />
        </Tab>
        <Tab value="tasks" label="任务">
          <Tasks view={view} />
        </Tab>
        <Tab value="workers" label="Worker">
          <Workers view={view} />
        </Tab>
        <Tab value="deliveries" label="交付">
          <Stack gap="md">
            <DeliveryTable view={view} />
            <Separator />
            <Heading level={3}>产物</Heading>
            <Artifacts view={view} />
          </Stack>
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

function RunSelector({
  listing: value,
  selected
}: {
  listing: RunListing
  selected: string
}) {
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
        <Badge tone={modeTone(mode)}>{MODE_LABEL[mode]}</Badge>
        <Badge tone={runStatusTone(status)}>{RUN_STATUS_LABEL[status]}</Badge>
        <Badge tone={healthTone(health)}>健康 {HEALTH_LABEL[health]}</Badge>
        <Badge tone={freshnessTone(freshness)}>时效 {FRESHNESS_LABEL[freshness]}</Badge>
        {summary && summary.availability !== 'available' ? (
          <Badge tone={availabilityTone(summary.availability)}>
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
                description="从上方列表选择一个运行以读取它的状态、任务、Worker 和交付。"
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
            只读观测 · 不写入运行状态 · 不执行编排
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
        数据来自 progress.json 与 progress 注册表；只显示记录事实，不推断成功。缺失、损坏、不可用和过期状态会明确标出。
      </Text>
    </Stack>
  )
}
