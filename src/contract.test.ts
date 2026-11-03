// Snapshot parsing and projection tests. The two real-* fixtures are produced
// by the orchestra-auto-zh progress.py recorder (see test/fixtures/README.md).
import { assert, test } from 'orca/testing'
import { readFileSync } from 'node:fs'
import { DELIVERY_FIELDS, MAX_DELIVERIES, MAX_EVENTS, MAX_TASKS } from './contract'
import { parseSnapshot, type Snapshot } from './snapshot'
import { projectRun } from './projection'

function fixture(name: string): string {
  return readFileSync(new URL('../test/fixtures/' + name, import.meta.url), 'utf8')
}

const FIXTURE_NOW = Date.parse('2026-11-03T15:21:11.816821Z')

test('projects a real recorder snapshot without inventing success', () => {
  const view = projectRun(parseSnapshot(fixture('real-active/progress.json')), {
    source: 'audit-root',
    now: FIXTURE_NOW
  })
  assert.equal(view.schemaVersion, 2)
  assert.equal(view.id, 'fixture-active')
  assert.equal(view.status, 'active')
  assert.equal(view.health, 'unknown')
  assert.equal(view.mode, 'REAL')
  assert.equal(view.taskCounts.total, 5)
  assert.equal(view.taskCounts.accepted, 1)
  assert.equal(view.taskCounts.running, 1)
  assert.equal(view.taskCounts.blocked, 1)
  assert.equal(view.taskCounts.waiting_user, 1)
  assert.equal(view.taskCounts.pending, 1)
  assert.equal(view.workers.length, 3)
  assert.equal(view.workerTotal, 3)
  assert.equal(view.deliveryTotal, 5)
  assert.equal(view.attentionTotal, 3)

  const plan = view.deliveries.find((item) => item.taskId === 't-plan')
  assert.ok(plan)
  assert.equal(plan.implemented, true)
  assert.equal(plan.integrated, true)
  assert.equal(plan.merged, true)
  assert.equal(plan.trackerClosed, false)
  assert.equal(plan.evidenceCount, 2)

  const panel = view.deliveries.find((item) => item.taskId === 't-panel')
  assert.ok(panel)
  assert.equal(panel.implemented, false)
  assert.equal(panel.integrated, null)
  assert.equal(panel.merged, null)
  assert.equal(panel.trackerClosed, null)

  assert.deepEqual(view.deliveryCounts.implemented, { yes: 1, no: 1, unverified: 3 })
  assert.deepEqual(view.deliveryCounts.integrated, { yes: 1, no: 0, unverified: 4 })
  assert.deepEqual(view.deliveryCounts.merged, { yes: 1, no: 0, unverified: 4 })
  assert.deepEqual(view.deliveryCounts.tracker_closed, { yes: 0, no: 1, unverified: 4 })
  assert.equal(view.deliveryMissingTasks, 0)

  assert.equal(view.events[0].bookkeeping, true)
  assert.equal(view.eventTotal, 14)
  assert.ok(view.attention.some((item) => item.kind === 'blocked'))
  assert.ok(view.attention.some((item) => item.kind === 'decision'))
  assert.ok(view.attention.some((item) => item.kind === 'worker-lost'))

  const serialized = JSON.stringify(view)
  assert.ok(!serialized.includes('/tmp/orchestra-auto-fixture-target'))
  assert.ok(!serialized.includes('https://example.invalid/report'))
  assert.ok(!serialized.includes('https://example.invalid/pr/1'))
  assert.ok(!serialized.includes('deadbeef'))
  assert.ok(!serialized.includes('receipts'))
})

test('a finished snapshot is not the same as verified deliveries', () => {
  const view = projectRun(parseSnapshot(fixture('real-finished/progress.json')), {
    source: 'registry',
    now: FIXTURE_NOW
  })
  assert.equal(view.status, 'completed')
  assert.equal(view.health, 'unknown')
  assert.equal(view.workerTotal, 1)
  assert.equal(view.deliveryTotal, 1)
  assert.equal(view.attentionTotal, 0)
  assert.equal(view.deliveryCounts.implemented.yes, 1)
  assert.equal(view.deliveryCounts.merged.yes, 1)
  assert.equal(view.deliveryCounts.tracker_closed.yes, 1)
})

test('view arrays are bounded while the counts stay complete', () => {
  const snapshot = parseSnapshot(fixture('real-finished/progress.json'))
  for (let index = 0; index < 600; index += 1) {
    snapshot.tasks['bulk-' + index] = {
      id: 'bulk-' + index,
      title: 'Bulk task ' + index,
      status: 'pending'
    }
  }
  const view = projectRun(snapshot, { source: 'registry', now: FIXTURE_NOW })
  assert.equal(view.tasks.length, MAX_TASKS)
  assert.equal(view.taskCounts.total, 601)
  assert.equal(view.deliveries.length, MAX_DELIVERIES)
  assert.equal(view.deliveryTotal, 601)
  assert.equal(view.workerTotal, 1)
  assert.equal(view.attentionTotal, 0)
})

test('worker self-report stays separate from verified lifecycle and task status', () => {
  const snapshot = parseSnapshot(fixture('real-active/progress.json'))
  const worker = snapshot.workers['w-plan-a1'] as Record<string, unknown>
  assert.equal(worker.lifecycle, 'closed')
  assert.equal(worker.reported_lifecycle, 'reported_done')
  const view = projectRun(snapshot, { source: 'audit-root', now: FIXTURE_NOW })
  const projected = view.workers.find((item) => item.id === 'w-plan-a1')
  assert.ok(projected)
  assert.equal(projected.lifecycle, 'closed')
  assert.equal(projected.reportedLifecycle, 'reported_done')
  assert.equal(view.taskCounts.accepted, 1)

  const second = parseSnapshot(fixture('real-active/progress.json'))
  const reported = second.workers['w-panel-a1'] as Record<string, unknown>
  reported.lifecycle = 'running'
  reported.reported_lifecycle = 'failed'
  const withSelfReport = projectRun(second, { source: 'audit-root', now: FIXTURE_NOW })
  assert.ok(
    withSelfReport.attention.some((item) => item.text.includes('自报失败（未核验）'))
  )
})

test('missing deliveries are unverified, never successes', () => {
  const snapshot = parseSnapshot(fixture('real-finished/progress.json'))
  snapshot.tasks['t2'] = {
    id: 't2',
    title: 'Second task',
    dependencies: [],
    status: 'accepted'
  }
  snapshot.deliveries = {}
  const view = projectRun(snapshot, { source: 'registry', now: FIXTURE_NOW })
  assert.equal(view.taskCounts.total, 2)
  assert.equal(view.deliveryMissingTasks, 2)
  for (const field of DELIVERY_FIELDS) {
    assert.equal(view.deliveryCounts[field].yes, 0)
    assert.equal(view.deliveryCounts[field].no, 0)
    assert.equal(view.deliveryCounts[field].unverified, 2)
  }
  const tasksWithoutDelivery = view.deliveries.filter((item) => !item.recorded)
  assert.equal(tasksWithoutDelivery.length, 2)
})

test('full worktree paths and artifact references are not in the view', () => {
  const snapshot = parseSnapshot(fixture('real-active/progress.json'))
  const worker = snapshot.workers['w-panel-a1'] as Record<string, unknown>
  worker.worktree = '/Users/example/secret/project/worktree'
  const view = projectRun(snapshot, { source: 'audit-root', now: FIXTURE_NOW })
  const projected = view.workers.find((item) => item.id === 'w-panel-a1')
  assert.ok(projected)
  assert.equal(projected.worktree, 'worktree')
  assert.equal(JSON.stringify(view).includes('/Users/example'), false)
  assert.deepEqual(
    view.artifacts.map((item) => ({ kind: item.kind, label: item.label })),
    [{ kind: 'report', label: 'Acceptance report' }]
  )
})

test('freshness distinguishes current, stale and unknown observations', () => {
  const snapshot = parseSnapshot(fixture('real-active/progress.json'))
  const observed = Date.parse('2026-11-03T15:21:11.235693Z')
  assert.equal(
    projectRun(snapshot, { source: 'audit-root', now: observed }).freshness,
    'current'
  )
  assert.equal(
    projectRun(snapshot, { source: 'audit-root', now: observed + 301_000 }).freshness,
    'stale'
  )
  const noObservation = parseSnapshot(fixture('real-finished/progress.json'))
  delete (noObservation.run as Record<string, unknown>).last_observed
  assert.equal(
    projectRun(noObservation, { source: 'registry', now: FIXTURE_NOW }).freshness,
    'unknown'
  )
})

test('schema v1 stays readable and unknown values stay unknown', () => {
  const v1: Snapshot = parseSnapshot(
    JSON.stringify({
      schema_version: 1,
      run: {
        id: 'v1-run',
        target_repo: '/tmp/v1-target',
        mode: 'REAL',
        status: 'active'
      },
      tasks: {
        t1: { id: 't1', title: 'Old task', status: 'running' }
      },
      workers: {
        w1: { id: 'w1', task_id: 't1', start_confirmation: 'unsupported', lifecycle: 'running' }
      },
      deliveries: {},
      artifacts: {},
      receipts: {},
      events: []
    })
  )
  const view = projectRun(v1, { source: 'registry', now: FIXTURE_NOW })
  assert.equal(view.schemaVersion, 1)
  assert.equal(view.status, 'active')
  assert.equal(view.health, 'unknown')
  assert.equal(view.orcaRunId, null)
  assert.equal(view.workers[0].startConfirmation, 'unsupported')
  assert.equal(view.deliveryCounts.implemented.unverified, 1)
})

test('events are capped and sorted newest first', () => {
  const snapshot = parseSnapshot(fixture('real-active/progress.json'))
  const events = snapshot.events as unknown[]
  while (events.length < MAX_EVENTS + 5) {
    events.push({
      id: 'extra-' + events.length,
      at: '2026-11-03T15:21:11.000000+00:00',
      type: 'event',
      source: 'coordinator',
      summary: 'extra'
    })
  }
  const view = projectRun(snapshot, { source: 'audit-root', now: FIXTURE_NOW })
  assert.equal(view.events.length, MAX_EVENTS)
  assert.equal(view.eventTotal, MAX_EVENTS + 5)
  for (let index = 1; index < view.events.length; index += 1) {
    assert.ok((view.events[index - 1].at ?? -1) >= (view.events[index].at ?? -1))
  }
})

test('invalid snapshots carry a stable problem code', () => {
  const active = JSON.parse(fixture('real-active/progress.json')) as Record<string, unknown>
  const check = (value: unknown, code: string) => {
    try {
      parseSnapshot(JSON.stringify(value))
      assert.fail('expected a SnapshotError')
    } catch (error) {
      assert.equal((error as { code?: string }).code, code)
    }
  }
  try {
    parseSnapshot('{')
    assert.fail('expected a SnapshotError')
  } catch (error) {
    assert.equal((error as { code?: string }).code, 'invalid_json')
  }
  check({ ...active, schema_version: 3 }, 'unsupported_schema')
  check({ ...active, artifacts: [] }, 'invalid_shape')
  check({ ...active, run: { ...(active.run as object), health: 'sick' } }, 'invalid_shape')
  check({ ...active, run: { ...(active.run as object), id: 'a/b' } }, 'invalid_shape')
  check({ ...active, run: { ...(active.run as object), target_repo: '' } }, 'invalid_shape')
  check(
    {
      ...active,
      tasks: { t1: { id: 't1', status: 'running', provisional: 'yes' } }
    },
    'invalid_shape'
  )
  check(
    {
      ...active,
      events: [{ id: 'e1', type: 'event', summary: 'x', bookkeeping: 'yes' }]
    },
    'invalid_shape'
  )
})
