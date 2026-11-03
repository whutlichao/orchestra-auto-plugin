// Snapshot parser for orchestra-auto progress.json (schema v1 and v2).
//
// Structural validation only: the checks follow the recorder's read contract
// (schema version, required collections, readable health and Orca IDs). Unknown
// enum values are projected to `unknown` later, so one bad status does not hide
// the rest of the snapshot. Receipts are validated but never returned.
import {
  CORRUPT_PROBLEMS,
  RUN_HEALTH,
  isPortableId,
  isRecord,
  type RunProblemCode
} from './contract'

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

export function isCorruptProblem(code: RunProblemCode): boolean {
  return CORRUPT_PROBLEMS.has(code)
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
