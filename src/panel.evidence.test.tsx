// Reproducible UI evidence from Orca's own components-panel runtime.
//
// These tests mount the real panel module on an isolated mock host, drive the
// real controls (Select, refresh IconButton), and print `UI_EVIDENCE ...` lines
// with the rendered summary. They are the interaction evidence; a PNG capture
// is a separate still-frame check and needs Orca's window hidden/minimized.
import { afterEach, assert, hostError, mockHost, mount, test, type TestPanel } from 'orca/testing'
import * as panel from './panel'
import {
  corruptSummary,
  sampleListing,
  sampleFinishedView,
  sampleView,
  unavailableSummary
} from './sample-data'

let view: TestPanel | undefined

afterEach(async () => {
  await view?.unmount()
  view = undefined
})

function summaryOf(panelView: TestPanel): string {
  return panelView.summary().join(' | ')
}

test('UI evidence: select another run and refresh the listing', async () => {
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

  const evidence = ['initial: ' + summaryOf(view)]
  assert.ok(view.find({ text: /示例：只读观测面板/ }))

  await view.select({ label: '运行' }, 'demo-finished')
  evidence.push('after-select-demo-finished: ' + summaryOf(view))
  assert.ok(view.find({ text: /示例：已完成运行/ }))

  await view.press({ label: '刷新' })
  evidence.push('after-refresh: ' + summaryOf(view))
  assert.equal(listingCalls, 2)
  assert.ok(view.find({ text: /示例：已完成运行/ }))

  console.log('UI_EVIDENCE switch_refresh ' + JSON.stringify(evidence))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('UI evidence: unavailable and corrupt states render as errors', async () => {
  const evidence: string[] = []

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
  evidence.push('unavailable: ' + summaryOf(view))
  assert.ok(view.find({ text: /progress.json 缺失或不可读/ }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
  view = undefined

  view = await mount(panel, {
    host: mockHost({
      capabilities: ['settings:own'],
      requests: {
        'runs.list': () => ({
          ...sampleListing,
          runs: [corruptSummary],
          warnings: ['有 1 个运行不可用或损坏']
        }),
        'run.get': () => {
          throw hostError('run_corrupt', 'progress.json 不是有效 JSON')
        }
      }
    })
  })
  evidence.push('corrupt: ' + summaryOf(view))
  assert.ok(view.find({ text: /progress.json 不是有效 JSON/ }))
  assert.ok(view.find({ text: /快照损坏/ }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])

  console.log('UI_EVIDENCE unavailable_corrupt ' + JSON.stringify(evidence))
})
