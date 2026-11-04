// Recorded topology between the run's coordinator and its workers.
//
// The only edges are `parent_worker_id` values that resolve inside the workers
// the projection actually carries, plus each worker's `task_id`. A missing,
// invalid, unresolved or cyclic parent is reported as such and is never attached
// to the coordinator or to another worker by guesswork.
import {
  recordedParentId,
  recordedTaskId,
  type AttentionItem,
  type RunView,
  type TaskView,
  type WorkerView
} from './contract'

/** Deepest worker chain drawn before the rest is listed flat in the anomaly group. */
export const MAX_TOPOLOGY_WORKER_DEPTH = 12

export type WorkerRelation =
  | 'root'
  | 'child'
  | 'missing-parent'
  | 'invalid-parent'
  | 'unresolved-parent'
  | 'cycle'
  | 'depth-limit'

export type TopologyWorker = {
  worker: WorkerView
  task: TaskView | null
  taskMissing: boolean
  relation: WorkerRelation
  /** The recorded parent ID when the field was recorded; null when absent or invalid. */
  parentId: string | null
  attention: AttentionItem[]
  children: TopologyWorker[]
  descendantCount: number
}

export type TopologyCounts = {
  total: number
  roots: number
  nested: number
  anomalies: number
  detachedTasks: number
  workersWithoutRecordedTask: number
  workersWithInvalidTask: number
}

export type Topology = {
  roots: TopologyWorker[]
  /** Workers whose recorded parent cannot be resolved, plus depth-limited rows. */
  anomalies: TopologyWorker[]
  detachedTasks: TaskView[]
  counts: TopologyCounts
  projectionTruncated: boolean
  depthLimited: number
}

type TopologyInput = Pick<RunView, 'tasks' | 'workers' | 'attention' | 'workerTotal'>

function findCycleMembers(
  workers: Map<string, WorkerView>,
  parents: Map<string, string>
): Set<string> {
  const state = new Map<string, 1 | 2>()
  const cycles = new Set<string>()
  for (const start of workers.keys()) {
    if (state.has(start)) continue
    const path: string[] = []
    let current: string | undefined = start
    while (current !== undefined) {
      const known = state.get(current)
      if (known === 2) break
      if (known === 1) {
        const at = path.indexOf(current)
        if (at !== -1) {
          for (const member of path.slice(at)) cycles.add(member)
        }
        break
      }
      state.set(current, 1)
      path.push(current)
      current = parents.get(current)
      if (current !== undefined && !workers.has(current)) break
    }
    for (const member of path) state.set(member, 2)
  }
  return cycles
}

function relationOf(
  worker: WorkerView,
  workers: Map<string, WorkerView>,
  cycles: Set<string>,
  projectionTruncated: boolean
): WorkerRelation {
  if (cycles.has(worker.id)) return 'cycle'
  if (worker.parentState === 'invalid') return 'invalid-parent'
  const parentId = recordedParentId(worker)
  if (parentId === null) return 'root'
  if (workers.has(parentId)) return 'child'
  return projectionTruncated ? 'unresolved-parent' : 'missing-parent'
}

export function buildTopology(view: TopologyInput): Topology {
  const workers = new Map(view.workers.map((worker) => [worker.id, worker]))
  const tasks = new Map(view.tasks.map((task) => [task.id, task]))
  const projectionTruncated = view.workerTotal > view.workers.length

  const parents = new Map<string, string>()
  for (const worker of view.workers) {
    const parentId = recordedParentId(worker)
    if (parentId !== null) parents.set(worker.id, parentId)
  }
  const cycles = findCycleMembers(workers, parents)

  const attentionFor = new Map<string, AttentionItem[]>()
  const addAttention = (workerId: string, item: AttentionItem) => {
    const list = attentionFor.get(workerId) ?? []
    list.push(item)
    attentionFor.set(workerId, list)
  }
  for (const item of view.attention) {
    if (item.workerId !== undefined) {
      addAttention(item.workerId, item)
    } else if (item.taskId !== undefined) {
      for (const worker of view.workers) {
        if (recordedTaskId(worker) === item.taskId) addAttention(worker.id, item)
      }
    }
  }

  const childrenOf = new Map<string, WorkerView[]>()
  for (const worker of view.workers) {
    const parentId = recordedParentId(worker)
    if (parentId === null) continue
    // A cycle member is listed in the anomaly group; it never becomes a child
    // of another member of the same cycle.
    if (cycles.has(worker.id)) continue
    if (!workers.has(parentId)) continue
    const list = childrenOf.get(parentId) ?? []
    list.push(worker)
    childrenOf.set(parentId, list)
  }

  const seen = new Set<string>()
  const relationCount: Record<WorkerRelation, number> = {
    root: 0,
    child: 0,
    'missing-parent': 0,
    'invalid-parent': 0,
    'unresolved-parent': 0,
    cycle: 0,
    'depth-limit': 0
  }
  let workersWithoutRecordedTask = 0
  let workersWithInvalidTask = 0
  const depthLimitedRows: TopologyWorker[] = []

  const makeNode = (
    worker: WorkerView,
    relation: WorkerRelation,
    children: TopologyWorker[]
  ): TopologyWorker => {
    const taskId = recordedTaskId(worker)
    const task = taskId !== null ? tasks.get(taskId) ?? null : null
    const taskMissing = task === null
    if (taskMissing) {
      if (worker.taskState === 'invalid') workersWithInvalidTask += 1
      else workersWithoutRecordedTask += 1
    }
    relationCount[relation] += 1
    const descendantCount = children.reduce((sum, child) => sum + 1 + child.descendantCount, 0)
    return {
      worker,
      task,
      taskMissing,
      relation,
      parentId: recordedParentId(worker),
      attention: attentionFor.get(worker.id) ?? [],
      children,
      descendantCount
    }
  }

  const collectTooDeep = (start: WorkerView) => {
    const queue = [start]
    for (let index = 0; index < queue.length; index += 1) {
      const next = queue[index]
      if (next === undefined || seen.has(next.id)) continue
      seen.add(next.id)
      depthLimitedRows.push(makeNode(next, 'depth-limit', []))
      for (const child of childrenOf.get(next.id) ?? []) {
        if (!seen.has(child.id)) queue.push(child)
      }
    }
  }

  const buildNode = (
    worker: WorkerView,
    relation: WorkerRelation,
    depth: number
  ): TopologyWorker => {
    seen.add(worker.id)
    const children: TopologyWorker[] = []
    for (const child of childrenOf.get(worker.id) ?? []) {
      if (seen.has(child.id)) continue
      if (depth >= MAX_TOPOLOGY_WORKER_DEPTH) {
        collectTooDeep(child)
      } else {
        children.push(buildNode(child, 'child', depth + 1))
      }
    }
    return makeNode(worker, relation, children)
  }

  const roots: TopologyWorker[] = []
  const anomalies: TopologyWorker[] = []
  const relations = new Map<string, WorkerRelation>()
  const rootWorkers: WorkerView[] = []
  const anomalyWorkers: WorkerView[] = []
  for (const worker of view.workers) {
    const relation = relationOf(worker, workers, cycles, projectionTruncated)
    relations.set(worker.id, relation)
    if (relation === 'root') rootWorkers.push(worker)
    else if (relation !== 'child') anomalyWorkers.push(worker)
  }
  for (const worker of rootWorkers) {
    if (!seen.has(worker.id)) roots.push(buildNode(worker, 'root', 1))
  }
  for (const worker of anomalyWorkers) {
    if (seen.has(worker.id)) continue
    const relation = relations.get(worker.id) ?? 'missing-parent'
    anomalies.push(buildNode(worker, relation, 1))
  }
  anomalies.push(...depthLimitedRows)

  const linkedTaskIds = new Set<string>()
  for (const worker of view.workers) {
    const taskId = recordedTaskId(worker)
    if (taskId !== null) linkedTaskIds.add(taskId)
  }
  const detachedTasks = view.tasks
    .filter((task) => !linkedTaskIds.has(task.id))
    .sort((a, b) => a.id.localeCompare(b.id))

  const anomalyRelations: WorkerRelation[] = [
    'missing-parent',
    'invalid-parent',
    'unresolved-parent',
    'cycle',
    'depth-limit'
  ]
  return {
    roots,
    anomalies,
    detachedTasks,
    counts: {
      total: seen.size,
      roots: relationCount.root,
      nested: relationCount.child,
      anomalies: anomalyRelations.reduce((sum, relation) => sum + relationCount[relation], 0),
      detachedTasks: detachedTasks.length,
      workersWithoutRecordedTask,
      workersWithInvalidTask
    },
    projectionTruncated,
    depthLimited: depthLimitedRows.length
  }
}

/** Find one worker node in either the root tree or the anomaly list. */
export function topologyNode(topology: Topology, workerId: string): TopologyWorker | null {
  const pending: TopologyWorker[] = [...topology.roots, ...topology.anomalies]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined) break
    if (node.worker.id === workerId) return node
    pending.push(...node.children)
  }
  return null
}
