// Topology resolver tests: recorded parent_worker_id and task associations only.
// No ordering is inferred when the recorded parent is missing, invalid or part
// of a cycle.
import { assert, test } from 'orca/testing'
import type { AttentionItem, TaskView, WorkerView } from './contract'
import { buildTopology } from './topology'

function task(
  id: string,
  title: string,
  status: TaskView['status'] = 'pending',
  overrides: Partial<TaskView> = {}
): TaskView {
  return {
    id,
    title,
    status,
    dependencies: [],
    blockedReason: '',
    pendingDecision: '',
    provisional: false,
    orcaTaskId: null,
    ...overrides
  }
}

function worker(id: string, taskId: string | null, overrides: Partial<WorkerView> = {}): WorkerView {
  return {
    id,
    taskId,
    dispatchId: 'd-' + id,
    attempt: 1,
    parentWorkerId: null,
    parentState: 'none',
    taskState: taskId === null ? 'none' : 'recorded',
    lifecycle: 'running',
    reportedLifecycle: 'unknown',
    startConfirmation: 'observed',
    reportedSummary: '',
    worktree: '',
    lastObservedAt: null,
    freshness: 'unknown',
    ...overrides
  }
}

function topologyOf(
  workers: WorkerView[],
  tasks: TaskView[] = [],
  attention: AttentionItem[] = [],
  workerTotal = workers.length
) {
  return buildTopology({ tasks, workers, attention, workerTotal })
}

test('links recorded children to their parent worker and carries the task', () => {
  const tasks = [task('t-plan', 'Plan', 'accepted'), task('t-panel', 'Panel', 'running')]
  const topology = topologyOf([
    worker('w-plan', 't-plan'),
    worker('w-panel', 't-panel', { parentWorkerId: 'w-plan', parentState: 'recorded' })
  ], tasks)

  assert.equal(topology.roots.length, 1)
  assert.equal(topology.roots[0].worker.id, 'w-plan')
  assert.equal(topology.roots[0].relation, 'root')
  assert.equal(topology.roots[0].task?.title, 'Plan')
  assert.equal(topology.roots[0].children.length, 1)
  assert.equal(topology.roots[0].children[0].worker.id, 'w-panel')
  assert.equal(topology.roots[0].children[0].relation, 'child')
  assert.equal(topology.roots[0].children[0].parentId, 'w-plan')
  assert.equal(topology.roots[0].children[0].task?.title, 'Panel')
  assert.deepEqual(topology.counts, {
    total: 2,
    roots: 1,
    nested: 1,
    anomalies: 0,
    detachedTasks: 0,
    workersWithoutRecordedTask: 0,
    workersWithInvalidTask: 0
  })
})

test('a recorded parent that is absent is an orphan, never a direct report', () => {
  const topology = topologyOf([
    worker('w-orphan', 't1', { parentWorkerId: 'w-ghost', parentState: 'recorded' })
  ], [task('t1', 'One')])

  assert.equal(topology.roots.length, 0)
  assert.equal(topology.anomalies.length, 1)
  assert.equal(topology.anomalies[0].relation, 'missing-parent')
  assert.equal(topology.anomalies[0].parentId, 'w-ghost')
  assert.equal(topology.anomalies[0].children.length, 0)
})

test('an invalid parent record is unknown, not a missing worker', () => {
  const topology = topologyOf([
    worker('w-unknown', 't1', { parentState: 'invalid' })
  ], [task('t1', 'One')])

  assert.equal(topology.anomalies.length, 1)
  assert.equal(topology.anomalies[0].relation, 'invalid-parent')
  assert.equal(topology.anomalies[0].parentId, null)
})

test('a cycle is reported as a cycle and its non-cycle children stay attached', () => {
  const topology = topologyOf([
    worker('w-a', 't1', { parentWorkerId: 'w-b', parentState: 'recorded' }),
    worker('w-b', 't2', { parentWorkerId: 'w-a', parentState: 'recorded' }),
    worker('w-c', 't3', { parentWorkerId: 'w-a', parentState: 'recorded' })
  ], [task('t1', 'One'), task('t2', 'Two'), task('t3', 'Three')])

  assert.equal(topology.roots.length, 0)
  assert.equal(topology.anomalies.length, 2)
  assert.deepEqual(
    topology.anomalies.map((node) => [node.worker.id, node.relation]).sort(),
    [['w-a', 'cycle'], ['w-b', 'cycle']]
  )
  const cycleA = topology.anomalies.find((node) => node.worker.id === 'w-a')
  assert.ok(cycleA)
  assert.deepEqual(cycleA.children.map((node) => node.worker.id), ['w-c'])
  assert.equal(topology.anomalies.some((node) => node.worker.id === 'w-c'), false)
})

test('a missing task association stays explicit', () => {
  const topology = topologyOf([
    worker('w-no-task', null, { taskState: 'none' }),
    worker('w-ghost-task', 't-ghost', { taskState: 'recorded' }),
    worker('w-bad-task', null, { taskState: 'invalid' })
  ], [task('t-real', 'Real')])

  const byId = new Map(topology.roots.map((node) => [node.worker.id, node]))
  assert.equal(byId.get('w-no-task')?.task, null)
  assert.equal(byId.get('w-no-task')?.taskMissing, true)
  assert.equal(byId.get('w-ghost-task')?.task, null)
  assert.equal(byId.get('w-ghost-task')?.taskMissing, true)
  assert.equal(byId.get('w-bad-task')?.task, null)
  assert.equal(byId.get('w-bad-task')?.taskMissing, true)
  assert.equal(topology.detachedTasks.length, 1)
  assert.equal(topology.detachedTasks[0].id, 't-real')
  assert.equal(topology.counts.workersWithoutRecordedTask, 2)
  assert.equal(topology.counts.workersWithInvalidTask, 1)
})

test('attention items reach the workers that share the task', () => {
  const attention: AttentionItem[] = [
    { id: 'task-blocked:t-panel', kind: 'blocked', text: 'Panel: blocked', taskId: 't-panel' },
    { id: 'worker-lost:w-lost', kind: 'worker-lost', text: 'w-lost: lost', workerId: 'w-lost' }
  ]
  const topology = topologyOf([
    worker('w-panel', 't-panel'),
    worker('w-panel-2', 't-panel'),
    worker('w-lost', 't-other'),
    worker('w-calm', 't-other')
  ], [task('t-panel', 'Panel'), task('t-other', 'Other')], attention)

  const byId = new Map(topology.roots.map((node) => [node.worker.id, node]))
  assert.deepEqual(byId.get('w-panel')?.attention.map((item) => item.id), ['task-blocked:t-panel'])
  assert.deepEqual(byId.get('w-panel-2')?.attention.map((item) => item.id), ['task-blocked:t-panel'])
  assert.deepEqual(byId.get('w-lost')?.attention.map((item) => item.id), ['worker-lost:w-lost'])
  assert.deepEqual(byId.get('w-calm')?.attention, [])
})

test('a parent outside the projected worker array is unresolved, not missing', () => {
  const topology = topologyOf(
    [worker('w-child', 't1', { parentWorkerId: 'w-beyond', parentState: 'recorded' })],
    [task('t1', 'One')],
    [],
    600
  )

  assert.equal(topology.projectionTruncated, true)
  assert.equal(topology.anomalies[0].relation, 'unresolved-parent')
  assert.equal(topology.anomalies[0].parentId, 'w-beyond')
})

test('an empty snapshot has an empty topology and lists its detached tasks', () => {
  const topology = topologyOf([], [task('t1', 'One'), task('t2', 'Two')])

  assert.deepEqual(topology.roots, [])
  assert.deepEqual(topology.anomalies, [])
  assert.deepEqual(topology.detachedTasks.map((item) => item.id), ['t1', 't2'])
  assert.equal(topology.counts.total, 0)
  assert.equal(topology.counts.detachedTasks, 2)
})

test('deep recorded chains stop before the renderer depth limit', () => {
  const workers: WorkerView[] = []
  const tasks: TaskView[] = []
  for (let index = 0; index < 20; index += 1) {
    tasks.push(task('t' + index, 'Task ' + index))
    workers.push(
      worker('w' + index, 't' + index, index === 0
        ? {}
        : { parentWorkerId: 'w' + (index - 1), parentState: 'recorded' })
    )
  }
  const topology = topologyOf(workers, tasks)

  assert.equal(topology.roots.length, 1)
  assert.equal(topology.depthLimited > 0, true)
  assert.equal(topology.counts.total, 20)
  assert.ok(topology.anomalies.every((node) => node.relation === 'depth-limit'))
})
