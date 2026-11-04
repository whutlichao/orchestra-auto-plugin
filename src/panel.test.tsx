// Panel tests: the recorded topology graph, explicit relationship gaps,
// on-demand details, narrow columns, empty and large states. The worker is
// always stubbed, so no audit directory is read.
import { afterEach, assert, hostError, mockHost, mount, test, type TestPanel } from 'orca/testing'
import * as panel from './panel'
import {
  sampleListing,
  sampleFinishedView,
  sampleRootsView,
  sampleView,
  unconfiguredListing,
  unavailableSummary
} from './sample-data'

let view: TestPanel | undefined

afterEach(async () => {
  await view?.unmount()
  view = undefined
})

function readyHost() {
  return mockHost({
    capabilities: ['settings:own'],
    requests: {
      'runs.list': () => sampleListing,
      'run.get': (input: unknown) =>
        (input as { runId: string }).runId === 'demo-finished' ? sampleFinishedView : sampleView
    }
  })
}

function hostFor(run: typeof sampleView) {
  return mockHost({
    capabilities: ['settings:own'],
    requests: {
      'runs.list': () => sampleListing,
      'run.get': () => run
    }
  })
}

/** The drawn element shape the test kit exposes, enough to inspect connector props. */
type DrawnElement = { type: string; props: Record<string, unknown> }

/** Members are joined to the coordinator by 2 px dashed membership ticks. */
function membershipTicks(panelView: TestPanel): DrawnElement[] {
  return (panelView.findAll({ type: 'Box' }) as DrawnElement[]).filter(
    (element) =>
      element.props.border === 'accent' &&
      element.props.width === 3 &&
      element.props.height === 2
  )
}

/**
 * Recorded parent edges are the solid 1 px lines; membership ticks are 2 px
 * dashes and the spine is 2 px, so line thickness separates the two kinds.
 */
function recordedParentLines(panelView: TestPanel): DrawnElement[] {
  return (panelView.findAll({ type: 'Box' }) as DrawnElement[]).filter(
    (element) =>
      element.props.border === 'accent' &&
      (element.props.width === 1 || element.props.height === 1)
  )
}

test('six top-level stale workers are one coordinator graph, not six stacked cards', async () => {
  view = await mount(panel, { host: hostFor(sampleRootsView) })

  // Every top-level worker is joined to the coordinator by a drawn membership
  // edge: no edge could be inferred from a parent record, so the run itself is
  // the only honest connection and it must be visible.
  assert.equal(membershipTicks(view).length, 18)
  // No worker-to-worker edge exists in this projection.
  assert.equal(recordedParentLines(view).length, 0)

  // The stale observation is a run-level fact: it is stated once and not
  // repeated as a badge on every node.
  assert.equal(view.findAll({ text: '观测过期' }).length, 0)
  assert.equal(view.findAll({ text: /时效 已过期/ }).length, 1)

  // All six nodes are drawn.
  for (const id of [
    'w-impl-a1',
    'w-spec-a1',
    'w-m2-impl',
    'w-m2-spec',
    'w-m2-tickets',
    'w-tickets-a1'
  ]) {
    assert.ok(view.find({ text: new RegExp(id) }))
  }
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('renders the coordinator and the recorded hierarchy as a graph', async () => {
  view = await mount(panel, { host: readyHost() })
  assert.ok(view.find({ text: 'orchestra-auto' }))
  assert.ok(view.find({ text: '协调者' }))
  assert.ok(view.find({ text: /本运行/ }))
  assert.ok(view.find({ text: /运行归属图/ }))
  assert.ok(view.find({ text: /w-plan-a1/ }))
  assert.ok(view.find({ text: /w-panel-a1/ }))
  assert.ok(view.find({ text: /w-panel-helper/ }))
  assert.ok(view.find({ text: /实现只读面板/ }))
  assert.ok(view.find({ text: '运行中' }))
  // Recorded parent edges are drawn as line segments, not as text indentation.
  assert.ok(recordedParentLines(view).length > 0)
  // The graph is the main view: no tab bar hides it.
  assert.equal(view.find({ type: 'Tabs' }), null)
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('a top-level worker gets a run-membership edge but no invented parent edge', async () => {
  view = await mount(panel, {
    host: hostFor({
      ...sampleView,
      workerTotal: 1,
      attention: [],
      attentionTotal: 0,
      workers: [sampleView.workers[0]]
    })
  })
  assert.ok(view.find({ text: /w-plan-a1/ }))
  assert.ok(view.find({ text: /运行归属图 · 1 个顶层 Worker/ }))
  // Membership is drawn; no recorded parent edge may exist without a record.
  assert.equal(membershipTicks(view).length, 3)
  assert.equal(recordedParentLines(view).length, 0)
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('a selected node shows its recorded detail full width, and both close paths work', async () => {
  view = await mount(panel, { host: readyHost() })
  assert.equal(view.find({ text: /Worker 详情/ }), null)
  await view.press({ type: 'ListItem', text: /w-panel-a1/ })
  assert.ok(view.find({ text: /Worker 详情/ }))
  assert.ok(view.find({ text: /父 Worker w-plan-a1/ }))
  assert.ok(view.find({ text: /核验生命周期/ }))
  assert.ok(view.find({ text: /自报生命周期/ }))
  await view.press({ type: 'ListItem', text: /w-panel-a1/ })
  assert.equal(view.find({ text: /Worker 详情/ }), null)
  // The close control beside the detail is a second, explicit way to collapse it.
  await view.press({ type: 'ListItem', text: /w-panel-a1/ })
  assert.ok(view.find({ text: /Worker 详情/ }))
  await view.press({ label: '收起详情' })
  assert.equal(view.find({ text: /Worker 详情/ }), null)
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('keeps the on-demand sections closed until asked', async () => {
  view = await mount(panel, { host: readyHost() })
  assert.equal(view.find({ type: 'Heading', text: '运行元数据' }), null)
  assert.equal(view.find({ type: 'Table', label: '任务' }), null)
  const details = view.find({ type: 'Collapsible', label: '运行详情' })
  assert.equal(details?.props.open, false)
  const attention = view.find({ type: 'Collapsible', label: /关注事项/ })
  assert.equal(attention?.props.open, false)

  await view.toggle({ label: '运行详情' })
  assert.ok(view.find({ type: 'Heading', text: '运行元数据' }))
  assert.ok(view.find({ type: 'Table', label: '任务' }))
  assert.ok(view.find({ text: /未核验/ }))
  assert.ok(view.find({ text: /没有 delivery 不代表成功/ }))

  await view.toggle({ label: /关注事项/ })
  assert.ok(view.find({ type: 'Text', text: /等待审计目录权限/ }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('narrow task and delivery tables drop their wide columns', async () => {
  view = await mount(panel, { host: readyHost() })
  await view.toggle({ label: '运行详情' })
  assert.deepEqual(view.columnsOf({ label: '任务' }, { width: 336 }), [
    'id',
    'title',
    'status',
    'workers'
  ])
  assert.deepEqual(view.columnsOf({ label: '交付' }, { width: 336 }), [
    'task',
    'implemented',
    'merged'
  ])
  assert.ok(view.columnsOf({ label: '任务' }, { width: 800 }).includes('orca'))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('does not show a finished status for an active run with no verified delivery', async () => {
  const onlyActive = {
    ...sampleListing,
    runs: [sampleListing.runs[0]],
    warnings: []
  }
  view = await mount(panel, {
    host: mockHost({
      capabilities: ['settings:own'],
      requests: {
        'runs.list': () => onlyActive,
        'run.get': () => sampleView
      }
    })
  })
  assert.equal(view.find({ text: '已完成' }), null)
  await view.toggle({ label: '运行详情' })
  assert.ok(view.find({ text: /未核验/ }))
  assert.ok(view.find({ text: /没有 delivery 不代表成功/ }))
  assert.ok(view.find({ text: /ot-plan-1/ }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('shows an explicit empty graph when workers are not recorded', async () => {
  view = await mount(panel, {
    host: hostFor({
      ...sampleView,
      workerTotal: 0,
      workers: [],
      attention: []
    })
  })
  assert.ok(view.find({ text: /没有 Worker 记录/ }))
  assert.ok(view.find({ text: /这不代表没有执行/ }))
  assert.equal(view.find({ text: '协调者' }), null)
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('a parent cycle is shown as an anomaly, not as a hierarchy', async () => {
  view = await mount(panel, {
    host: hostFor({
      ...sampleView,
      workerTotal: 2,
      attention: [],
      attentionTotal: 0,
      workers: [
        {
          ...sampleView.workers[1],
          id: 'w-cycle-a',
          parentWorkerId: 'w-cycle-b',
          parentState: 'recorded'
        },
        {
          ...sampleView.workers[1],
          id: 'w-cycle-b',
          parentWorkerId: 'w-cycle-a',
          parentState: 'recorded'
        }
      ]
    })
  })
  assert.ok(view.find({ text: /关系异常 · 2/ }))
  assert.ok(view.find({ text: /父关系成环/ }))
  assert.ok(view.find({ text: /不并入协调者/ }))
  // Cycle members are not attached to the coordinator and have no parent edge.
  assert.equal(membershipTicks(view).length, 0)
  assert.equal(recordedParentLines(view).length, 0)
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('distinguishes an invalid task reference from an unrecorded task', async () => {
  view = await mount(panel, {
    host: hostFor({
      ...sampleView,
      workerTotal: 2,
      attention: [],
      attentionTotal: 0,
      workers: [
        {
          ...sampleView.workers[0],
          id: 'w-no-task',
          taskId: null,
          taskState: 'none'
        },
        {
          ...sampleView.workers[0],
          id: 'w-bad-task',
          taskId: null,
          taskState: 'invalid'
        }
      ]
    })
  })
  assert.ok(view.find({ text: /未记录任务 1/ }))
  assert.ok(view.find({ text: /任务记录无效 1/ }))
  await view.press({ type: 'ListItem', text: /w-no-task/ })
  assert.ok(view.find({ text: /未记录父 Worker/ }))
  await view.press({ type: 'ListItem', text: /w-bad-task/ })
  assert.ok(view.find({ text: /未记录父 Worker/ }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('bounds a large nested worker set and reports the true total', async () => {
  const roots = Array.from({ length: 120 }, (_, index) => ({
    ...sampleView.workers[0],
    id: 'w-bulk-' + index,
    taskId: 't-plan',
    parentWorkerId: null,
    parentState: 'none' as const,
    attempt: 1
  }))
  const children = Array.from({ length: 120 }, (_, index) => ({
    ...sampleView.workers[0],
    id: 'w-bulk-child-' + index,
    taskId: 't-plan',
    parentWorkerId: 'w-bulk-' + index,
    parentState: 'recorded' as const,
    attempt: 1
  }))
  const workers = [...roots, ...children]
  view = await mount(panel, {
    host: hostFor({
      ...sampleView,
      workerTotal: workers.length,
      workers,
      attention: [],
      attentionTotal: 0
    })
  })
  assert.ok(view.find({ text: /240 个 Worker/ }))
  assert.ok(view.find({ text: /50 \/ 120 顶层/ }))
  assert.ok(view.find({ text: /100 \/ 240 节点/ }))
  assert.ok(view.find({ text: /本运行 · 50 \/ 120 个顶层 Worker/ }))
  assert.ok(view.find({ text: /图中仅显示前 100 个 Worker（含嵌套节点），共 240 个/ }))
  assert.ok(view.find({ text: /w-bulk-0/ }))
  assert.equal(view.find({ text: /w-bulk-119/ }), null)
  assert.equal(view.findAll({ type: 'ListItem' }).length, 100)
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('a member cut by the render budget still states its hidden descendants', async () => {
  const roots = Array.from({ length: 100 }, (_, index) => ({
    ...sampleView.workers[0],
    id: 'w-limit-' + index,
    taskId: 't-plan',
    parentWorkerId: null,
    parentState: 'none' as const
  }))
  // The 100th member is the last rendered row; its two children fall outside
  // the 100-node budget, so the cut count belongs on that member row.
  const children = [0, 1].map((index) => ({
    ...sampleView.workers[0],
    id: 'w-limit-child-' + index,
    taskId: 't-plan',
    parentWorkerId: 'w-limit-99',
    parentState: 'recorded' as const
  }))
  view = await mount(panel, {
    host: hostFor({
      ...sampleView,
      workerTotal: roots.length + children.length,
      workers: [...roots, ...children],
      attention: [],
      attentionTotal: 0
    })
  })
  assert.ok(view.find({ text: /还有 2 个下层 Worker 未显示/ }))
  assert.ok(view.find({ text: /100 个顶层 Worker/ }))
  assert.ok(view.find({ text: /100 \/ 102 节点/ }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('keeps deep recorded chains and names the parent in the detail', async () => {
  const workers = Array.from({ length: 7 }, (_, index) => ({
    ...sampleView.workers[0],
    id: 'w-deep-' + index,
    taskId: 't-plan',
    parentWorkerId: index === 0 ? null : 'w-deep-' + (index - 1),
    parentState: index === 0 ? ('none' as const) : ('recorded' as const),
    attempt: 1
  }))
  view = await mount(panel, {
    host: hostFor({
      ...sampleView,
      workerTotal: workers.length,
      workers,
      attention: [],
      attentionTotal: 0
    })
  })
  for (let index = 0; index < workers.length; index += 1) {
    assert.ok(view.find({ text: new RegExp('w-deep-' + index) }))
  }
  await view.press({ type: 'ListItem', text: /w-deep-6/ })
  assert.ok(view.find({ text: /父 Worker w-deep-5/ }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('explains an unconfigured audit root without reading anything', async () => {
  view = await mount(panel, {
    host: mockHost({
      capabilities: ['settings:own'],
      requests: {
        'runs.list': () => unconfiguredListing
      }
    })
  })
  assert.ok(view.find({ text: /在 Orca 的 Settings/ }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('renders an unavailable run without replacing it with another run', async () => {
  view = await mount(panel, {
    host: mockHost({
      capabilities: ['settings:own'],
      requests: {
        'runs.list': () => ({
          ...sampleListing,
          runs: [unavailableSummary],
          warnings: ['有 1 个运行不可用或损坏']
        }),
        'run.get': () => {
          throw hostError('run_unavailable', 'progress.json 缺失或不可读')
        }
      }
    })
  })
  assert.ok(view.find({ text: /progress.json 缺失或不可读/ }))
  assert.ok(view.find({ text: /示例：不可用运行/ }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('refreshes the listing and selects another run', async () => {
  let listingCalls = 0
  view = await mount(panel, {
    host: mockHost({
      capabilities: ['settings:own'],
      requests: {
        'runs.list': () => {
          listingCalls += 1
          return sampleListing
        },
        'run.get': (input: unknown) =>
          (input as { runId: string }).runId === 'demo-finished' ? sampleFinishedView : sampleView
      }
    })
  })
  assert.equal(listingCalls, 1)
  await view.press({ label: '刷新' })
  assert.equal(listingCalls, 2)

  await view.select({ label: '运行' }, 'demo-finished')
  assert.ok(view.find({ text: /示例：已完成运行/ }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('shows the stale warning', async () => {
  view = await mount(panel, {
    host: mockHost({
      capabilities: ['settings:own'],
      requests: {
        'runs.list': () => sampleListing,
        'run.get': () => ({ ...sampleView, freshness: 'stale' as const })
      }
    })
  })
  assert.ok(view.find({ text: /过期≠失败/ }))
  assert.ok(view.find({ text: /时效 已过期/ }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('a failed listing keeps an explicit error instead of a false empty success', async () => {
  view = await mount(panel, {
    host: mockHost({
      capabilities: ['settings:own'],
      requests: {
        'runs.list': () => {
          throw hostError('timeout', 'timed out')
        }
      }
    })
  })
  assert.ok(view.find({ text: /读取超时/ }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('a worker whose parent is outside the projection stays unresolved', async () => {
  view = await mount(panel, {
    host: hostFor({
      ...sampleView,
      workerTotal: 501,
      attention: [],
      attentionTotal: 0,
      workers: [
        {
          ...sampleView.workers[1],
          id: 'w-orphan',
          parentWorkerId: 'w-outside-cap',
          parentState: 'recorded'
        }
      ]
    })
  })
  assert.ok(view.find({ text: /父节点未读取/ }))
  await view.press({ type: 'ListItem', text: /w-orphan/ })
  assert.ok(view.find({ text: /不在已读取的 Worker 中/ }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})
