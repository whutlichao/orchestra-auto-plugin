// Panel tests: the coordinator/worker topology, explicit relationship gaps,
// on-demand details, narrow columns, empty and large states. The worker is
// always stubbed.
import { afterEach, assert, hostError, mockHost, mount, test, type TestPanel } from 'orca/testing'
import * as panel from './panel'
import {
  sampleListing,
  sampleFinishedView,
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

test('renders the coordinator, recorded hierarchy, tasks and attention', async () => {
  view = await mount(panel, { host: readyHost() })
  assert.ok(view.find({ text: 'orchestra-auto' }))
  assert.ok(view.find({ text: /协调者 · 本运行/ }))
  assert.ok(view.find({ text: /w-panel-a1/ }))
  assert.ok(view.find({ text: /任务：实现只读面板 · 父 w-plan-a1/ }))
  assert.ok(view.find({ text: /需关注 2/ }))
  assert.ok(view.find({ text: /关系异常 · 2/ }))
  assert.ok(view.find({ text: /父 w-api-parent-ghost 未记录/ }))
  assert.ok(view.find({ text: /父 Worker 记录无效/ }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('a selected worker shows its recorded task, relation and lifecycle details', async () => {
  view = await mount(panel, { host: readyHost() })
  await view.press({ type: 'Button', text: 'w-panel-a1' })
  assert.ok(view.find({ text: /Worker 详情/ }))
  assert.ok(view.find({ text: /父 Worker w-plan-a1/ }))
  assert.ok(view.find({ text: /实现只读面板/ }))
  assert.ok(view.find({ text: /核验生命周期/ }))
  assert.ok(view.find({ text: /自报生命周期/ }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('renders recorded facts and marks missing delivery facts as unverified', async () => {
  view = await mount(panel, { host: readyHost() })
  assert.ok(view.find({ text: /示例：只读观测面板/ }))
  assert.ok(view.find({ text: /示例数据不代表真实执行或验收/ }))
  assert.ok(view.find({ text: /等待审计目录权限/ }))
  await view.select({ label: '运行详情' }, 'details')
  assert.ok(view.find({ text: /未核验/ }))
  assert.ok(view.find({ text: /没有 delivery 不代表成功/ }))
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
  await view.select({ label: '运行详情' }, 'details')
  assert.ok(view.find({ text: /未核验/ }))
  assert.ok(view.find({ text: /没有 delivery 不代表成功/ }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('keeps two tabs and hides wide task columns in a narrow sidebar', async () => {
  view = await mount(panel, { host: readyHost() })
  assert.deepEqual(
    view.findAll({ type: 'Tab' }).map((tab) => tab.label),
    ['拓扑', '细节']
  )
  await view.select({ label: '运行详情' }, 'details')
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
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('shows an explicit empty topology when workers are not recorded', async () => {
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
  assert.equal(view.find({ text: /协调者 · 本运行/ }), null)
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
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('renders a large worker set without duplicating or dropping it', async () => {
  const workers = Array.from({ length: 120 }, (_, index) => ({
    ...sampleView.workers[0],
    id: 'w-bulk-' + index,
    taskId: 't-plan',
    parentWorkerId: null,
    parentState: 'none' as const,
    attempt: 1
  }))
  view = await mount(panel, {
    host: hostFor({
      ...sampleView,
      workerTotal: workers.length,
      workers,
      attention: []
    })
  })
  assert.ok(view.find({ text: /Worker 120/ }))
  assert.ok(view.find({ text: /快照记录 120 个 Worker/ }))
  assert.ok(view.find({ text: /直属 Worker 仅显示前 100 个，共 120 个/ }))
  assert.ok(view.find({ text: /为保持可读/ }))
  assert.equal(view.find({ text: /w-bulk-119/ }), null)
  assert.equal(view.findAll({ type: 'Button' }).length, 100)
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
  assert.ok(view.find({ text: /过期不等于失败/ }))
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
