// Read-side vocabulary for orchestra-auto progress.json (schema v1 and v2).
//
// Declarations and shared helpers only: the snapshot parser lives in
// `snapshot.ts`, the projection in `projection.ts`, the recorded topology in
// `topology.ts`, and the rendered panel in `panel.tsx`. Nothing here reads
// files or infers success.

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

/** How a worker's recorded task/parent reference looks before topology is built. */
export const REFERENCE_STATES = ['none', 'recorded', 'invalid'] as const
export type ReferenceState = (typeof REFERENCE_STATES)[number]

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
  invalid_path: '状态路径无效'
}

/** Problem codes that mean the snapshot itself is unreadable or malformed. */
export const CORRUPT_PROBLEMS: ReadonlySet<RunProblemCode> = new Set<RunProblemCode>([
  'invalid_json',
  'unsupported_schema',
  'invalid_shape',
  'too_large'
])

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
export const MAX_TITLE = 200
export const MAX_LABEL = 200

export type TaskView = {
  id: string
  title: string
  status: TaskStatus
  dependencies: string[]
  blockedReason: string
  pendingDecision: string
  provisional: boolean
  orcaTaskId: string | null
}

export type WorkerView = {
  id: string
  taskId: string | null
  /** `none` for no record, `recorded` for a portable ID, `invalid` for a bad value. */
  taskState: ReferenceState
  dispatchId: string | null
  attempt: number | null
  parentWorkerId: string | null
  /** `none` means the worker reports directly to the coordinator. */
  parentState: ReferenceState
  lifecycle: WorkerLifecycle
  reportedLifecycle: WorkerLifecycle
  startConfirmation: StartConfirmation
  reportedSummary: string
  worktree: string
  lastObservedAt: number | null
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
  observedAt: number | null
  taskCount: number
}

export type RootProblem = { index: number; reason: string }

export type RunListing = {
  configured: boolean
  runs: RunSummary[]
  warnings: string[]
  rootProblems: RootProblem[]
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

export function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

/**
 * Display text from an untrusted value: control characters and runs of
 * whitespace collapse to one space, then the text is capped at `max` with an
 * ellipsis. Non-strings become an empty string, never "undefined".
 */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const clean = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean
}
