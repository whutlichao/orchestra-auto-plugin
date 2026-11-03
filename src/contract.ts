// Read-side contract for orchestra-auto progress.json (schema v1 and v2).
//
// This module is pure: it parses one snapshot and projects the recorded facts.
// It never reads files, never writes, and never infers success. Missing values
// stay unknown; a missing delivery is unverified, not a success.

export const RUN_STATUSES = [
  'unknown',
  'active',
  'waiting_user',
  'failed',
  'paused',
  'completed',
  'cancelled'
] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export const RUN_HEALTH = ['healthy', 'degraded', 'blocked', 'lost', 'unknown'] as const
export type RunHealth = (typeof RUN_HEALTH)[number]

export const TASK_STATUSES = [
  'unknown',
  'pending',
  'ready',
  'running',
  'blocked',
  'waiting_user',
  'reported',
  'accepted',
  'rejected',
  'failed',
  'paused',
  'cancelled'
] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const WORKER_LIFECYCLES = [
  'unknown',
  'dispatched',
  'running',
  'waiting_user',
  'reported_done',
  'failed',
  'lost',
  'reclaimable',
  'closed'
] as const
export type WorkerLifecycle = (typeof WORKER_LIFECYCLES)[number]

// `unsupported` is a schema-v1 read-side value; keep it visible instead of
// pretending the start was observed or unobserved.
export const START_CONFIRMATIONS = [
  'unknown',
  'observed',
  'unobserved',
  'unsupported'
] as const
export type StartConfirmation = (typeof START_CONFIRMATIONS)[number]

export const DELIVERY_FIELDS = [
  'implemented',
  'integrated',
  'merged',
  'tracker_closed'
] as const
export type DeliveryField = (typeof DELIVERY_FIELDS)[number]

export const ARTIFACT_KINDS = ['report', 'test', 'commit', 'pr', 'other'] as const
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

export const RUN_MODES = ['REAL', 'DEMO'] as const
export type RunMode = (typeof RUN_MODES)[number] | 'unknown'

export type Freshness = 'current' | 'stale' | 'unknown'
export type RunSource = 'registry' | 'audit-root'
export type RunAvailability = 'available' | 'unavailable' | 'corrupt'

export type RunProblemCode =
  | 'missing'
  | 'unreadable'
  | 'invalid_json'
  | 'unsupported_schema'
  | 'invalid_shape'
  | 'too_large'
  | 'symlink'
  | 'outside_audit_roots'
  | 'invalid_descriptor'
  | 'invalid_path'
  | 'audit_roots_invalid'

export const PROBLEM_TEXT: Record<RunProblemCode, string> = {
  missing: 'progress.json 缺失或不可读',
  unreadable: 'progress.json 无法读取',
  invalid_json: 'progress.json 不是有效 JSON',
  unsupported_schema: '不支持的 schema 版本',
  invalid_shape: 'progress.json 结构不符合 v1/v2 契约',
  too_large: 'progress.json 超过读取上限',
  symlink: '路径包含符号链接，已拒绝读取',
  outside_audit_roots: '状态目录不在已配置的审计目录内',
  invalid_descriptor: '注册表描述文件无效',
  invalid_path: '状态路径无效',
  audit_roots_invalid: '没有可用的审计目录'
}

export const STALE_SECONDS = 300
export const RUN_LABEL_MAX_CHARS = 120
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024
export const MAX_TASKS = 500
export const MAX_WORKERS = 500
export const MAX_DELIVERIES = 500
export const MAX_ATTENTION = 100
export const MAX_EVENTS = 20
export const MAX_ARTIFACTS = 100
export const MAX_TEXT = 300
const MAX_TITLE = 200
const MAX_LABEL = 200
const MAX_ID = 128

export type SnapshotProblemCode = Extract<
  RunProblemCode,
  'invalid_json' | 'unsupported_schema' | 'invalid_shape' | 'too_large'
>

export class SnapshotError extends Error {
  readonly code: SnapshotProblemCode

  constructor(code: SnapshotProblemCode, message: string) {
    super(message)
    this.name = 'SnapshotError'
    this.code = code
  }
}

export type Snapshot = {
  schemaVersion: 1 | 2
  run: Record<string, unknown>
  tasks: Record<string, unknown>
  workers: Record<string, unknown>
  deliveries: Record<string, unknown>
  artifacts: Record<string, unknown>
  events: unknown[]
  warnings: string[]
}

export type TaskView = {
  id: string
  title: string
  status: TaskStatus
  dependencies: string[]
  blockedReason: string
  pendingDecision: string
  provisional: boolean
  orcaTaskId: string | null
  verifiedAt: number | null
}

export type WorkerView = {
  id: string
  taskId: string | null
  dispatchId: string | null
  attempt: number | null
  parentWorkerId: string | null
  lifecycle: WorkerLifecycle
  reportedLifecycle: WorkerLifecycle
  startConfirmation: StartConfirmation
  reportedSummary: string
  worktree: string
  lastObservedAt: number | null
  verifiedAt: number | null
  freshness: Freshness
}

export type DeliveryView = {
  taskId: string
  recorded: boolean
  implemented: boolean | null
  integrated: boolean | null
  merged: boolean | null
  trackerClosed: boolean | null
  evidenceCount: number
}

export type DeliveryCount = { yes: number; no: number; unverified: number }

export type ArtifactView = {
  id: string
  taskId: string | null
  kind: ArtifactKind
  label: string
}

export type EventView = {
  index: number
  id: string
  at: number | null
  type: string
  source: string
  summary: string
  bookkeeping: boolean
}

export type AttentionItem = {
  id: string
  kind: 'blocked' | 'decision' | 'failed' | 'rejected' | 'worker-failed' | 'worker-lost'
  text: string
}

export type RunView = {
  id: string
  title: string
  source: RunSource
  schemaVersion: 1 | 2
  status: RunStatus
  health: RunHealth
  mode: RunMode
  phase: string
  summary: string
  orcaRunId: string | null
  startedAt: number | null
  updatedAt: number | null
  lastObservedAt: number | null
  lastEffectiveProgressAt: number | null
  endedAt: number | null
  freshness: Freshness
  tasks: TaskView[]
  taskCounts: Record<TaskStatus, number> & { total: number }
  workers: WorkerView[]
  workerTotal: number
  deliveries: DeliveryView[]
  deliveryTotal: number
  deliveryCounts: Record<DeliveryField, DeliveryCount>
  deliveryMissingTasks: number
  artifacts: ArtifactView[]
  artifactTotal: number
  events: EventView[]
  eventTotal: number
  attention: AttentionItem[]
  attentionTotal: number
  warnings: string[]
}

export type RunSummary = {
  id: string
  label: string
  source: RunSource
  availability: RunAvailability
  problem: RunProblemCode | null
  status: RunStatus
  health: RunHealth
  mode: RunMode
  phase: string
  observedAt: number | null
  endedAt: number | null
  taskCount: number
}

export type RootProblem = { index: number; reason: string }

export type RunListing = {
  configured: boolean
  runs: RunSummary[]
  warnings: string[]
  rootProblems: RootProblem[]
  truncated: boolean
  scannedAt: number
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isPortableId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value)
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const clean = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean
}

function text(value: unknown, max: number): string {
  return cleanText(value, max)
}

function portableOrNull(value: unknown): string | null {
  return isPortableId(value) ? value : null
}

function positiveIntOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value === '') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function freshness(at: number | null, now: number, staleMs: number): Freshness {
  if (at === null) return 'unknown'
  return now - at >= staleMs ? 'stale' : 'current'
}

function recordValues(raw: Record<string, unknown>, label: string): Record<string, unknown> {
  for (const [key, value] of Object.entries(raw)) {
    if (!isPortableId(key)) {
      throw new SnapshotError('invalid_shape', label + ' key is not a portable identifier')
    }
    if (!isRecord(value)) {
      throw new SnapshotError('invalid_shape', label + ' entry is not an object')
    }
  }
  return raw
}

/**
 * Parse and structurally validate a progress.json snapshot.
 *
 * The checks follow the recorder's read contract: schema v1/v2, required
 * top-level objects, a non-empty target repository, readable health and Orca
 * IDs. Unknown enum values are projected to `unknown` later, not treated as
 * corruption, so a single bad status does not hide the rest of the snapshot.
 * Receipts are validated but never returned: they are private bookkeeping.
 */
export function parseSnapshot(raw: string): Snapshot {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new SnapshotError('invalid_json', 'snapshot is not valid JSON')
  }
  if (!isRecord(parsed)) {
    throw new SnapshotError('invalid_shape', 'snapshot root is not an object')
  }
  const version = parsed.schema_version
  if (version !== 1 && version !== 2) {
    throw new SnapshotError('unsupported_schema', 'unsupported snapshot schema_version')
  }
  for (const key of ['run', 'tasks', 'workers', 'deliveries', 'artifacts', 'receipts']) {
    if (!isRecord(parsed[key])) {
      throw new SnapshotError('invalid_shape', 'snapshot field is not an object: ' + key)
    }
  }
  if (!Array.isArray(parsed.events)) {
    throw new SnapshotError('invalid_shape', 'snapshot events is not a list')
  }

  const run = parsed.run
  if (!isPortableId(run.id)) {
    throw new SnapshotError('invalid_shape', 'run.id is not a portable identifier')
  }
  if (typeof run.target_repo !== 'string' || run.target_repo === '') {
    throw new SnapshotError('invalid_shape', 'run.target_repo is missing')
  }
  if ('status' in run && typeof run.status !== 'string') {
    throw new SnapshotError('invalid_shape', 'run.status is not a string')
  }
  if ('health' in run && !(RUN_HEALTH as readonly unknown[]).includes(run.health)) {
    throw new SnapshotError('invalid_shape', 'run.health is not a known value')
  }
  if (run.orca_run_id != null && !isPortableId(run.orca_run_id)) {
    throw new SnapshotError('invalid_shape', 'run.orca_run_id is not a portable identifier')
  }
  if ('mode' in run && typeof run.mode !== 'string') {
    throw new SnapshotError('invalid_shape', 'run.mode is not a string')
  }

  const tasks = recordValues(parsed.tasks, 'task')
  for (const task of Object.values(tasks) as Record<string, unknown>[]) {
    if ('provisional' in task && typeof task.provisional !== 'boolean') {
      throw new SnapshotError('invalid_shape', 'task.provisional is not a boolean')
    }
    if (task.orca_task_id != null && !isPortableId(task.orca_task_id)) {
      throw new SnapshotError('invalid_shape', 'task.orca_task_id is not a portable identifier')
    }
    if ('status' in task && typeof task.status !== 'string') {
      throw new SnapshotError('invalid_shape', 'task.status is not a string')
    }
  }

  const workers = recordValues(parsed.workers, 'worker')
  const deliveries = recordValues(parsed.deliveries, 'delivery')
  const artifacts = recordValues(parsed.artifacts, 'artifact')

  const warnings: string[] = []
  let skippedEvents = 0
  for (const event of parsed.events) {
    if (!isRecord(event)) {
      skippedEvents += 1
      continue
    }
    if ('bookkeeping' in event && typeof event.bookkeeping !== 'boolean') {
      throw new SnapshotError('invalid_shape', 'event.bookkeeping is not a boolean')
    }
  }
  if (skippedEvents > 0) {
    warnings.push('已跳过 ' + skippedEvents + ' 条格式不完整的事件')
  }

  return {
    schemaVersion: version,
    run,
    tasks,
    workers,
    deliveries,
    artifacts,
    events: parsed.events,
    warnings
  }
}

function worktreeLabel(value: unknown): string {
  if (typeof value !== 'string') return ''
  const clean = value.trim()
  if (clean === '') return ''
  const parts = clean.split(/[\\/]/).filter(Boolean)
  const base = parts.length > 0 ? parts[parts.length - 1] : clean
  return text(base, 80)
}

function projectTasks(snapshot: Snapshot): TaskView[] {
  const tasks: TaskView[] = []
  for (const [key, raw] of Object.entries(snapshot.tasks)) {
    const task = raw as Record<string, unknown>
    tasks.push({
      id: key,
      title: text(task.title, MAX_TITLE) || key,
      status: enumValue(task.status, TASK_STATUSES, 'unknown'),
      dependencies: Array.isArray(task.dependencies)
        ? task.dependencies.filter(isPortableId).slice(0, 20)
        : [],
      blockedReason: text(task.blocked_reason, MAX_TEXT),
      pendingDecision: text(task.pending_decision, MAX_TEXT),
      provisional: task.provisional === true,
      orcaTaskId: portableOrNull(task.orca_task_id),
      verifiedAt: timestamp(task.verified_at)
    })
  }
  return tasks
}

function projectWorkers(snapshot: Snapshot, now: number, staleMs: number): WorkerView[] {
  const workers: WorkerView[] = []
  for (const [key, raw] of Object.entries(snapshot.workers)) {
    const worker = raw as Record<string, unknown>
    const lastObservedAt = timestamp(worker.last_observed)
    workers.push({
      id: key,
      taskId: portableOrNull(worker.task_id),
      dispatchId: portableOrNull(worker.dispatch_id),
      attempt: positiveIntOrNull(worker.attempt),
      parentWorkerId: portableOrNull(worker.parent_worker_id),
      lifecycle: enumValue(worker.lifecycle, WORKER_LIFECYCLES, 'unknown'),
      reportedLifecycle: enumValue(worker.reported_lifecycle, WORKER_LIFECYCLES, 'unknown'),
      startConfirmation: enumValue(worker.start_confirmation, START_CONFIRMATIONS, 'unknown'),
      reportedSummary: text(worker.reported_summary, MAX_TEXT),
      worktree: worktreeLabel(worker.worktree),
      lastObservedAt,
      verifiedAt: timestamp(worker.verified_at),
      freshness: freshness(lastObservedAt, now, staleMs)
    })
  }
  workers.sort((a, b) => (a.taskId ?? '').localeCompare(b.taskId ?? '') ||
    (a.attempt ?? 0) - (b.attempt ?? 0) || a.id.localeCompare(b.id))
  return workers
}

function projectDeliveries(
  snapshot: Snapshot,
  tasks: TaskView[]
): {
  deliveries: DeliveryView[]
  counts: Record<DeliveryField, DeliveryCount>
  missingTasks: number
  duplicateDeliveries: number
} {
  const byTask = new Map<string, Record<string, unknown>>()
  let duplicateDeliveries = 0
  for (const [key, raw] of Object.entries(snapshot.deliveries)) {
    const delivery = raw as Record<string, unknown>
    const taskId = portableOrNull(delivery.task_id) ?? key
    if (byTask.has(taskId)) duplicateDeliveries += 1
    byTask.set(taskId, delivery)
  }
  const taskIds = new Set<string>()
  for (const task of tasks) taskIds.add(task.id)
  for (const taskId of byTask.keys()) taskIds.add(taskId)

  const deliveries: DeliveryView[] = []
  for (const taskId of [...taskIds].sort()) {
    const delivery = byTask.get(taskId)
    deliveries.push({
      taskId,
      recorded: delivery !== undefined,
      implemented: delivery && isBoolean(delivery.implemented) ? delivery.implemented : null,
      integrated: delivery && isBoolean(delivery.integrated) ? delivery.integrated : null,
      merged: delivery && isBoolean(delivery.merged) ? delivery.merged : null,
      trackerClosed: delivery && isBoolean(delivery.tracker_closed) ? delivery.tracker_closed : null,
      evidenceCount: delivery && Array.isArray(delivery.evidence) ? delivery.evidence.length : 0
    })
  }

  const counts: Record<DeliveryField, DeliveryCount> = {
    implemented: { yes: 0, no: 0, unverified: 0 },
    integrated: { yes: 0, no: 0, unverified: 0 },
    merged: { yes: 0, no: 0, unverified: 0 },
    tracker_closed: { yes: 0, no: 0, unverified: 0 }
  }
  for (const delivery of deliveries) {
    const values: Record<DeliveryField, boolean | null> = {
      implemented: delivery.implemented,
      integrated: delivery.integrated,
      merged: delivery.merged,
      tracker_closed: delivery.trackerClosed
    }
    for (const field of DELIVERY_FIELDS) {
      const value = values[field]
      if (value === true) counts[field].yes += 1
      else if (value === false) counts[field].no += 1
      else counts[field].unverified += 1
    }
  }
  const missingTasks = tasks.filter((task) => !byTask.has(task.id)).length
  return { deliveries, counts, missingTasks, duplicateDeliveries }
}

function projectArtifacts(snapshot: Snapshot): { artifacts: ArtifactView[]; total: number } {
  const all: ArtifactView[] = []
  for (const [key, raw] of Object.entries(snapshot.artifacts)) {
    const artifact = raw as Record<string, unknown>
    const kind = enumValue(artifact.kind, ARTIFACT_KINDS, 'other')
    all.push({
      id: key,
      taskId: portableOrNull(artifact.task_id),
      kind,
      label: text(artifact.label, MAX_LABEL) || key
    })
  }
  all.sort((a, b) => a.id.localeCompare(b.id))
  return { artifacts: all.slice(0, MAX_ARTIFACTS), total: all.length }
}

function projectEvents(snapshot: Snapshot): { events: EventView[]; total: number } {
  const all: EventView[] = []
  snapshot.events.forEach((raw, index) => {
    if (!isRecord(raw)) return
    all.push({
      index,
      id: text(raw.id, MAX_ID) || 'event-' + index,
      at: timestamp(raw.at),
      type: text(raw.type, 64) || 'unknown',
      source: text(raw.source, 32) || 'unknown',
      summary: text(raw.summary, MAX_TEXT),
      bookkeeping: raw.bookkeeping === true
    })
  })
  all.sort((a, b) => (b.at ?? -1) - (a.at ?? -1) || b.index - a.index)
  return { events: all.slice(0, MAX_EVENTS), total: all.length }
}

function projectAttention(
  tasks: TaskView[],
  workers: WorkerView[]
): AttentionItem[] {
  const items: AttentionItem[] = []
  for (const task of tasks) {
    if (task.status === 'blocked' || task.blockedReason !== '') {
      items.push({
        id: 'task-blocked:' + task.id,
        kind: 'blocked',
        text: task.title + '：' + (task.blockedReason || '已记录阻塞')
      })
    }
    if (task.status === 'waiting_user' || task.pendingDecision !== '') {
      items.push({
        id: 'task-decision:' + task.id,
        kind: 'decision',
        text: task.title + '：' + (task.pendingDecision || '等待用户决定')
      })
    }
    if (task.status === 'failed') {
      items.push({ id: 'task-failed:' + task.id, kind: 'failed', text: task.title + '：任务失败' })
    }
    if (task.status === 'rejected') {
      items.push({ id: 'task-rejected:' + task.id, kind: 'rejected', text: task.title + '：已打回' })
    }
  }
  for (const worker of workers) {
    if (worker.lifecycle === 'failed') {
      items.push({ id: 'worker-failed:' + worker.id, kind: 'worker-failed', text: worker.id + '：Worker 失败' })
    }
    if (worker.lifecycle === 'lost') {
      items.push({ id: 'worker-lost:' + worker.id, kind: 'worker-lost', text: worker.id + '：Worker 失联' })
    }
    if (worker.reportedLifecycle === 'failed' && worker.lifecycle !== 'failed') {
      items.push({
        id: 'worker-reported-failed:' + worker.id,
        kind: 'worker-failed',
        text: worker.id + '：Worker 自报失败（未核验）'
      })
    }
  }
  return items
}

/**
 * Project a parsed snapshot into the panel's view model.
 *
 * Every derived value is a recorded fact or an explicit "unknown"/"unverified".
 * There is no completion percentage, no inference that a missing delivery is a
 * success, and no raw path or evidence reference in the result.
 */
export function projectRun(
  snapshot: Snapshot,
  options: { source: RunSource; now?: number; staleSeconds?: number }
): RunView {
  const now = options.now ?? Date.now()
  const staleMs = (options.staleSeconds ?? STALE_SECONDS) * 1000
  const run = snapshot.run
  const lastObservedAt = timestamp(run.last_observed)
  const allTasks = projectTasks(snapshot)
  const allWorkers = projectWorkers(snapshot, now, staleMs)
  const delivery = projectDeliveries(snapshot, allTasks)
  const attention = projectAttention(allTasks, allWorkers)
  const artifacts = projectArtifacts(snapshot)
  const events = projectEvents(snapshot)
  const health = enumValue(run.health, RUN_HEALTH, 'unknown')

  const taskCounts: Record<TaskStatus, number> & { total: number } = {
    unknown: 0,
    pending: 0,
    ready: 0,
    running: 0,
    blocked: 0,
    waiting_user: 0,
    reported: 0,
    accepted: 0,
    rejected: 0,
    failed: 0,
    paused: 0,
    cancelled: 0,
    total: allTasks.length
  }
  for (const task of allTasks) taskCounts[task.status] += 1

  const warnings = [...snapshot.warnings]
  if (delivery.duplicateDeliveries > 0) {
    warnings.push('存在重复的交付记录；同一任务以最后一条为准')
  }

  return {
    id: run.id,
    title: text(run.title, MAX_TITLE),
    source: options.source,
    schemaVersion: snapshot.schemaVersion,
    status: enumValue(run.status, RUN_STATUSES, 'unknown'),
    health,
    mode: enumValue(run.mode, RUN_MODES, 'unknown'),
    phase: text(run.phase, 80),
    summary: text(run.summary, 500),
    orcaRunId: portableOrNull(run.orca_run_id),
    startedAt: timestamp(run.started_at),
    updatedAt: timestamp(run.updated_at),
    lastObservedAt,
    lastEffectiveProgressAt: timestamp(run.last_effective_progress),
    endedAt: timestamp(run.ended_at),
    freshness: freshness(lastObservedAt, now, staleMs),
    tasks: allTasks.slice(0, MAX_TASKS),
    taskCounts,
    workers: allWorkers.slice(0, MAX_WORKERS),
    workerTotal: allWorkers.length,
    deliveries: delivery.deliveries.slice(0, MAX_DELIVERIES),
    deliveryTotal: delivery.deliveries.length,
    deliveryCounts: delivery.counts,
    deliveryMissingTasks: delivery.missingTasks,
    artifacts: artifacts.artifacts,
    artifactTotal: artifacts.total,
    events: events.events,
    eventTotal: events.total,
    attention: attention.slice(0, MAX_ATTENTION),
    attentionTotal: attention.length,
    warnings
  }
}

export function labelFor(run: { id: string; title: string }, descriptorLabel = ''): string {
  const label = text(descriptorLabel, MAX_LABEL) || text(run.title, MAX_LABEL)
  return label || run.id
}
