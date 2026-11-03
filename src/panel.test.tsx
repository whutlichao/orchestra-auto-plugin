// Panel tests: loading, selection, refresh, unavailable/corrupt states and the
// "no false success" presentation. The worker is always stubbed.
import { afterEach, assert, hostError, mockHost, mount, test, type TestPanel } from 'orca/testing'
import * as panel from './panel'
import {
  sampleListing,
  sampleSecondView,
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
        (input as { runId: string }).runId === 'demo-finished' ? sampleSecondView : sampleView
    }
  })
}

test('renders recorded facts and marks missing delivery facts as unverified', async () => {
  view = await mount(panel, { host: readyHost() })
  assert.ok(view.find({ text: 'orchestra-auto' }))
  assert.ok(view.find({ text: /示例：只读观测面板/ }))
  assert.ok(view.find({ text: /示例数据不代表真实执行或验收/ }))
  assert.ok(view.find({ text: /未核验/ }))
  assert.ok(view.find({ text: /等待审计目录权限/ }))
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
  assert.ok(view.find({ text: /未核验/ }))
  assert.ok(view.find({ text: /没有 delivery 不代表成功/ }))
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
          (input as { runId: string }).runId === 'demo-finished' ? sampleSecondView : sampleView
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
