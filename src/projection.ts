// Projection from a parsed progress.json snapshot to the panel's view model.
//
// Every derived value is a recorded fact or an explicit "unknown"/"unverified".
// There is no completion percentage, no inference that a missing delivery is a
// success, and no raw path or evidence reference in the result.
import {
  ARTIFACT_KINDS,
  DELIVERY_FIELDS,
  MAX_ARTIFACTS,
  MAX_ATTENTION,
  MAX_DELIVERIES,
  MAX_EVENTS,
  MAX_LABEL,
  MAX_TASKS,
  MAX_TEXT,
  MAX_TITLE,
  MAX_WORKERS,
  RUN_HEALTH,
  RUN_MODES,
  RUN_STATUSES,
  START_CONFIRMATIONS,
  STALE_SECONDS,
  TASK_STATUSES,
  WORKER_LIFECYCLES,
  cleanText,
  enumValue,
  isBoolean,
  isPortableId,
  isRecord,
  type ArtifactView,
  type AttentionItem,
  type DeliveryCount,
  type DeliveryField,
  type DeliveryView,
  type EventView,
  type Freshness,
  type ReferenceState,
  type RunSource,
  type RunStatus,
  type RunView,
  type TaskStatus,
  type TaskView,
  type WorkerView
} from './contract'
import type { Snapshot } from './snapshot'

function portableOrNull(value: unknown): string | null {
  return isPortableId(value) ? value : null
}

/** Distinguishes a field that is absent from one recorded with a non-portable value. */
function referenceState(value: unknown): ReferenceState {
  if (value === null || value === undefined) return 'none'
  return isPortableId(value) ? 'recorded' : 'invalid'
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

function worktreeLabel(value: unknown): string {
  if (typeof value !== 'string') return ''
  // Basename only: a full worktree path must never reach the panel. Drive
  // letters, UNC shares and trailing `.`/`..` segments fall back to the last
  // real segment, or to '' when the path names no directory.
  const parts = value
    .trim()
    .split(/[\\/]+/)
    .filter((part) => part !== '' && part !== '.' && part !== '..' && !/^[A-Za-z]:$/.test(part))
  const base = parts.length > 0 ? parts[parts.length - 1] : ''
  return cleanText(base, 80)
}

function projectTasks(snapshot: Snapshot): TaskView[] {
  const tasks: TaskView[] = []
  for (const [key, raw] of Object.entries(snapshot.tasks)) {
    const task = raw as Record<string, unknown>
    tasks.push({
      id: key,
      title: cleanText(task.title, MAX_TITLE) || key,
      status: enumValue(task.status, TASK_STATUSES, 'unknown'),
      dependencies: Array.isArray(task.dependencies)
        ? task.dependencies.filter(isPortableId).slice(0, 20)
        : [],
      blockedReason: cleanText(task.blocked_reason, MAX_TEXT),
      pendingDecision: cleanText(task.pending_decision, MAX_TEXT),
      provisional: task.provisional === true,
      orcaTaskId: portableOrNull(task.orca_task_id)
    })
  }
  return tasks
}

function projectWorkers(snapshot: Snapshot, now: number, staleMs: number): WorkerView[] {
  const workers: WorkerView[] = []
  for (const [key, raw] of Object.entries(snapshot.workers)) {
    const worker = raw as Record<string, unknown>
    const lastObservedAt = timestamp(worker.last_observed)
    const taskState = referenceState(worker.task_id)
    const parentState = referenceState(worker.parent_worker_id)
    workers.push({
      id: key,
      taskId: taskState === 'recorded' ? (worker.task_id as string) : null,
      taskState,
      dispatchId: portableOrNull(worker.dispatch_id),
      attempt: positiveIntOrNull(worker.attempt),
      parentWorkerId: parentState === 'recorded' ? (worker.parent_worker_id as string) : null,
      parentState,
      lifecycle: enumValue(worker.lifecycle, WORKER_LIFECYCLES, 'unknown'),
      reportedLifecycle: enumValue(worker.reported_lifecycle, WORKER_LIFECYCLES, 'unknown'),
      startConfirmation: enumValue(worker.start_confirmation, START_CONFIRMATIONS, 'unknown'),
      reportedSummary: cleanText(worker.reported_summary, MAX_TEXT),
      worktree: worktreeLabel(worker.worktree),
      lastObservedAt,
      freshness: freshness(lastObservedAt, now, staleMs)
    })
  }
  workers.sort((a, b) => (a.taskId ?? '').localeCompare(b.taskId ?? '') ||
    (a.attempt ?? 0) - (b.attempt ?? 0) || a.id.localeCompare(b.id))
  return workers
}

type DeliveryProjection = {
  deliveries: DeliveryView[]
  counts: Record<DeliveryField, DeliveryCount>
  missingTasks: number
  duplicateDeliveries: number
}

function projectDeliveries(snapshot: Snapshot, tasks: TaskView[]): DeliveryProjection {
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
    all.push({
      id: key,
      taskId: portableOrNull(artifact.task_id),
      kind: enumValue(artifact.kind, ARTIFACT_KINDS, 'other'),
      label: cleanText(artifact.label, MAX_LABEL) || key
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
      at: timestamp(raw.at),
      type: cleanText(raw.type, 64) || 'unknown',
      source: cleanText(raw.source, 32) || 'unknown',
      summary: cleanText(raw.summary, MAX_TEXT),
      bookkeeping: raw.bookkeeping === true
    })
  })
  all.sort((a, b) => (b.at ?? -1) - (a.at ?? -1) || b.index - a.index)
  return { events: all.slice(0, MAX_EVENTS), total: all.length }
}

function projectAttention(
  tasks: TaskView[],
  workers: WorkerView[],
  runStatus: RunStatus
): AttentionItem[] {
  const items: AttentionItem[] = []
  const hasDecision = tasks.some(
    (task) => task.status === 'waiting_user' || task.pendingDecision !== ''
  )
  // The reference dashboard also raises a run-level item when the Run itself
  // records the state and no task carries the detail.
  if (!hasDecision && runStatus === 'waiting_user') {
    items.push({
      id: 'run-decision',
      kind: 'decision',
      text: '运行已标记等待用户：尚无具体决策记录'
    })
  }
  if (runStatus === 'failed') {
    items.push({ id: 'run-failed', kind: 'failed', text: '运行状态为失败' })
  }
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

function taskCountsOf(tasks: TaskView[]): Record<TaskStatus, number> & { total: number } {
  const counts: Record<TaskStatus, number> & { total: number } = {
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
    total: tasks.length
  }
  for (const task of tasks) counts[task.status] += 1
  return counts
}

export function projectRun(
  snapshot: Snapshot,
  options: { source: RunSource; now?: number; staleSeconds?: number }
): RunView {
  const now = options.now ?? Date.now()
  const staleMs = (options.staleSeconds ?? STALE_SECONDS) * 1000
  const run = snapshot.run
  const lastObservedAt = timestamp(run.last_observed)
  const tasks = projectTasks(snapshot)
  const workers = projectWorkers(snapshot, now, staleMs)
  const delivery = projectDeliveries(snapshot, tasks)
  const runStatus = enumValue(run.status, RUN_STATUSES, 'unknown')
  const attention = projectAttention(tasks, workers, runStatus)
  const artifacts = projectArtifacts(snapshot)
  const events = projectEvents(snapshot)

  const warnings = [...snapshot.warnings]
  if (delivery.duplicateDeliveries > 0) {
    warnings.push('存在重复的交付记录；同一任务以最后一条为准')
  }

  return {
    id: run.id,
    title: cleanText(run.title, MAX_TITLE),
    source: options.source,
    schemaVersion: snapshot.schemaVersion,
    status: runStatus,
    health: enumValue(run.health, RUN_HEALTH, 'unknown'),
    mode: enumValue(run.mode, RUN_MODES, 'unknown'),
    phase: cleanText(run.phase, 80),
    summary: cleanText(run.summary, 500),
    orcaRunId: portableOrNull(run.orca_run_id),
    startedAt: timestamp(run.started_at),
    lastObservedAt,
    lastEffectiveProgressAt: timestamp(run.last_effective_progress),
    endedAt: timestamp(run.ended_at),
    freshness: freshness(lastObservedAt, now, staleMs),
    tasks: tasks.slice(0, MAX_TASKS),
    taskCounts: taskCountsOf(tasks),
    workers: workers.slice(0, MAX_WORKERS),
    workerTotal: workers.length,
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
  const label = cleanText(descriptorLabel, MAX_LABEL) || cleanText(run.title, MAX_LABEL)
  return label || run.id
}
