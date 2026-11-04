// Recorded topology between the run's coordinator and its workers.
//
// The only edges are `parent_worker_id` values that resolve inside the workers
// the projection actually carries, plus each worker's `task_id`. A missing,
// invalid, unresolved or cyclic parent is reported as such and is never attached
// to the coordinator or to another worker by guesswork.
import type { AttentionItem, RunView, TaskView, WorkerView } from './contract'

/** Breadth of nesting kept below the renderer's Tree item-depth cap of 16. */
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
  unrecordedTasks: number
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
        if (at !== -1) for (const member of path.slice(at)) cycles.add(member)
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
  if (worker.parentState === 'none' || worker.parentWorkerId === null) return 'root'
  if (workers.has(worker.parentWorkerId)) return 'child'
  return projectionTruncated ? 'unresolved-parent' : 'missing-parent'
}

export function buildTopology(view: TopologyInput): Topology {  const workers = new Map(view.workers.map((worker) => [worker.id, worker]))
  const tasks = new Map(view.tasks.map((task) => [task.id, task]))
  const projectionTruncated = view.workerTotal > view.workers.length

  const parents = new Map<string, string>()
  for (const worker of view.workers) {
    if (worker.parentState === 'recorded' && worker.parentWorkerId !== null) {
      parents.set(worker.id, worker.parentWorkerId)
    }
  }
  const cycles = findCycleMembers(workers, parents)

  const attentionFor = new Map<string, AttentionItem[]>()
  const addAttention = (workerId: string, item: AttentionItem) => {
    const list = attentionFor.get(workerId) ?? []
    list.push(item)
    attentionFor.set(workerId, list)
  }
  for (const item of view.attention) {
    const colon = item.id.indexOf(':')
    const prefix = colon === -1 ? item.id : item.id.slice(0, colon)
    const target = colon === -1 ? '' : item.id.slice(colon + 1)
    if (prefix.startsWith('worker-')) {
      addAttention(target, item)
    } else if (prefix.startsWith('task-')) {
      for (const worker of view.workers) {
        if (worker.taskState === 'recorded' && worker.taskId === target) {
          addAttention(worker.id, item)
        }
      }
    }
  }

  const childrenOf = new Map<string, WorkerView[]>()
  for (const worker of view.workers) {
    if (worker.parentState !== 'recorded' || worker.parentWorkerId === null) continue
    // A cycle member is listed in the anomaly group; it never becomes a child
    // of another member of the same cycle.
    if (cycles.has(worker.id)) continue
    if (!workers.has(worker.parentWorkerId)) continue
    const list = childrenOf.get(worker.parentWorkerId) ?? []
    list.push(worker)
    childrenOf.set(worker.parentWorkerId, list)
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
  let unrecordedTasks = 0
  const depthLimitedRows: TopologyWorker[] = []

  const makeNode = (
    worker: WorkerView,
    relation: WorkerRelation,
    children: TopologyWorker[]
  ): TopologyWorker => {
    const task =
      worker.taskState === 'recorded' && worker.taskId !== null
        ? tasks.get(worker.taskId) ?? null
        : null
    const taskMissing = task === null
    if (taskMissing) unrecordedTasks += 1
    relationCount[relation] += 1
    const descendantCount = children.reduce((sum, child) => sum + 1 + child.descendantCount, 0)
    return {
      worker,
      task,
      taskMissing,
      relation,
      parentId: worker.parentState === 'recorded' ? worker.parentWorkerId : null,
      attention: attentionFor.get(worker.id) ?? [],
      children,
      descendantCount
    }
  }

  const collectTooDeep = (start: WorkerView) => {
    const queue = [start]
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      if (seen.has(next.id)) continue
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
  const rootWorkers: WorkerView[] = []
  const anomalyWorkers: WorkerView[] = []
  for (const worker of view.workers) {
    const relation = relationOf(worker, workers, cycles, projectionTruncated)
    if (relation === 'root') rootWorkers.push(worker)
    else if (relation !== 'child') anomalyWorkers.push(worker)
  }
  for (const worker of rootWorkers) {
    if (!seen.has(worker.id)) roots.push(buildNode(worker, 'root', 1))
  }
  for (const worker of anomalyWorkers) {
    if (!seen.has(worker.id)) anomalies.push(buildNode(worker, relationOf(worker, workers, cycles, projectionTruncated), 1))
  }
  anomalies.push(...depthLimitedRows)

  const linkedTaskIds = new Set<string>()
  for (const worker of view.workers) {
    if (worker.taskState === 'recorded' && worker.taskId !== null) linkedTaskIds.add(worker.taskId)
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
      unrecordedTasks
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
