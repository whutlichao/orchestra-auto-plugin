// Graph render-plan tests: pre-order rows, rail flags for recorded ancestors,
// and an honest cut count when the render budget is smaller than the tree.
import { assert, test } from 'orca/testing'
import type { WorkerView } from './contract'
import { planGraph } from './graph'
import type { TopologyWorker } from './topology'

function worker(id: string, parentId: string | null = null): WorkerView {
  return {
    id,
    taskId: null,
    taskState: 'none',
    dispatchId: null,
    attempt: null,
    parentWorkerId: parentId,
    parentState: parentId === null ? 'none' : 'recorded',
    lifecycle: 'running',
    reportedLifecycle: 'unknown',
    startConfirmation: 'observed',
    reportedSummary: '',
    worktree: '',
    lastObservedAt: null,
    freshness: 'unknown'
  }
}

function node(id: string, children: TopologyWorker[] = []): TopologyWorker {
  return {
    worker: worker(id),
    task: null,
    taskMissing: true,
    relation: 'root',
    parentId: null,
    attention: [],
    children,
    descendantCount: children.reduce((sum, child) => sum + 1 + child.descendantCount, 0)
  }
}

test('an empty worker set plans no rows', () => {
  const plan = planGraph([], 100)
  assert.deepEqual(plan, { rows: [], total: 0, shown: 0, truncated: false })
})

test('rows are drawn in pre-order with the recorded depth', () => {
  const tree = [node('a', [node('a1', [node('a1x')]), node('a2')]), node('b')]
  const plan = planGraph(tree, 100)
  assert.deepEqual(
    plan.rows.map((row) => [row.node.worker.id, row.depth]),
    [
      ['a', 0],
      ['a1', 1],
      ['a1x', 2],
      ['a2', 1],
      ['b', 0]
    ]
  )
  assert.equal(plan.total, 5)
  assert.equal(plan.truncated, false)
})

test('a trunk is drawn only for recorded parents with a later sibling', () => {
  // a -> a1 -> a1x, with a1 having a later sibling a2 and a having b.
  const tree = [node('a', [node('a1', [node('a1x')]), node('a2')]), node('b')]
  const rows = new Map(planGraph(tree, 100).rows.map((row) => [row.node.worker.id, row]))

  // Top-level rows have no recorded parent: no rail may imply one.
  assert.deepEqual(rows.get('a')?.rails, [])
  assert.equal(rows.get('a')?.hasFollowingSibling, true)
  // a1 is a's child: its siblings share the recorded parent a, so a rail exists
  // only for levels below a1. a1 itself has no rail.
  assert.deepEqual(rows.get('a1')?.rails, [])
  assert.equal(rows.get('a1')?.hasFollowingSibling, true)
  // a1x keeps the a1 sibling trunk, but never a trunk above a (unrecorded).
  assert.deepEqual(rows.get('a1x')?.rails, [true])
  assert.equal(rows.get('a1x')?.hasFollowingSibling, false)
  assert.deepEqual(rows.get('a2')?.rails, [])
  assert.equal(rows.get('a2')?.hasFollowingSibling, false)
  assert.deepEqual(rows.get('b')?.rails, [])
  assert.equal(rows.get('b')?.hasFollowingSibling, false)
})

test('a render budget keeps the first rows and counts every hidden node', () => {
  const tree = [node('a', [node('a1', [node('a1x'), node('a1y')]), node('a2')]), node('b')]
  const plan = planGraph(tree, 2)
  assert.deepEqual(
    plan.rows.map((row) => row.node.worker.id),
    ['a', 'a1']
  )
  assert.equal(plan.total, 6)
  assert.equal(plan.shown, 2)
  assert.equal(plan.truncated, true)
  // Each row counts the nodes hidden directly under it: a hides a2, a1 hides a1x and a1y.
  // Root b never renders, so no row can name it; the plan's own total does.
  assert.equal(plan.rows[0]?.cutChildren, 1)
  assert.equal(plan.rows[1]?.cutChildren, 2)
  assert.equal(plan.total - plan.shown, 4)
})

test('a zero budget shows nothing and hides the whole tree', () => {
  const plan = planGraph([node('a', [node('a1')])], 0)
  assert.deepEqual(plan.rows, [])
  assert.equal(plan.total, 2)
  assert.equal(plan.truncated, true)
})

test('deep chains keep one rail per recorded ancestor level below the top', () => {
  let deepest = node('w9')
  for (let index = 8; index >= 0; index -= 1) {
    deepest = node('w' + index, [deepest])
  }
  const plan = planGraph([deepest], 100)
  assert.equal(plan.rows.length, 10)
  // The top-level worker has no recorded parent, so its first child starts the
  // rail levels one rung lower than a bare depth count would.
  assert.deepEqual(
    plan.rows.map((row) => row.rails.length),
    [0, 0, 1, 2, 3, 4, 5, 6, 7, 8]
  )
  assert.equal(
    plan.rows.every((row) => row.rails.every((active) => active === false)),
    true
  )
})
