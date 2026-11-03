// Worker tests: the panel contract, error codes and the read-only host surface.
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as main from './worker'

const bases: string[] = []

afterEach(() => {
  for (const base of bases.splice(0)) rmSync(base, { recursive: true, force: true })
})

function fixture(name: string): string {
  return readFileSync(new URL('../test/fixtures/' + name, import.meta.url), 'utf8')
}

function base(): string {
  const value = mkdtempSync(join(realpathSync(tmpdir()), 'orca-worker-'))
  bases.push(value)
  return value
}

function writeRun(dir: string, raw = fixture('real-active/progress.json')): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'progress.json'), raw)
}

async function rejects(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise
    assert.fail('expected a rejection')
  } catch (error) {
    assert.equal((error as { code?: string }).code, code)
  }
}

function setup() {
  const root = base()
  const audit = join(root, 'audit')
  const registry = join(root, 'registry')
  writeRun(join(audit, 'active'))
  writeRun(join(audit, 'finished'), fixture('real-finished/progress.json'))
  writeRun(join(audit, 'broken'), '{not json')
  mkdirSync(join(registry, 'runs'), { recursive: true })
  writeFileSync(
    join(registry, 'runs', 'fixture-active.json'),
    JSON.stringify({
      run_id: 'fixture-active',
      state_path: join(audit, 'active'),
      label: 'Registry label'
    })
  )
  writeFileSync(
    join(registry, 'runs', 'missing.json'),
    JSON.stringify({
      run_id: 'missing',
      state_path: join(audit, 'missing')
    })
  )
  return { root, audit, registry }
}

test('lists runs and reads one without exposing paths or writing anything', async () => {
  const { root, audit, registry } = setup()
  const host = mockHost({ settings: { auditRoots: audit, registryHome: registry } })
  const worker = await mountWorker(main, { host })

  const listing = await worker.request('runs.list')
  assert.equal(listing.configured, true)
  assert.ok(listing.runs.some((run) => run.id === 'fixture-active'))
  assert.ok(listing.runs.some((run) => run.id === 'missing'))
  assert.ok(JSON.stringify(listing).includes(root) === false)

  const view = await worker.request('run.get', { runId: 'fixture-active' })
  assert.equal(view.id, 'fixture-active')
  assert.equal(view.title, 'Fixture: active run')
  assert.equal(view.status, 'active')
  assert.equal(view.taskCounts.total, 5)
  assert.equal(JSON.stringify(view).includes(root), false)
  assert.equal(JSON.stringify(view).includes('/tmp/orchestra-auto-fixture-target'), false)

  await rejects(worker.request('run.get', { runId: 'broken' }), 'run_corrupt')
  await rejects(worker.request('run.get', { runId: 'missing' }), 'run_unavailable')
  await rejects(worker.request('run.get', { runId: 'nope' }), 'run_not_found')
  await rejects(worker.request('run.get', { runId: '../etc' }), 'invalid_run_id')
  await rejects(
    worker.request('run.get', { runId: 'fixture-active', extra: true } as never),
    'invalid_params'
  )

  assert.deepEqual(worker.refusals, [])
  assert.deepEqual(worker.posts, [])
  assert.ok(worker.host.calls.length > 0)
  for (const call of worker.host.calls) {
    assert.equal(call.method, 'settings.get')
  }
  await worker.deactivate()
})

test('unconfigured settings produce an unconfigured listing and read nothing', async () => {
  const host = mockHost({ settings: {} })
  const worker = await mountWorker(main, { host })
  const listing = await worker.request('runs.list')
  assert.equal(listing.configured, false)
  assert.equal(listing.runs.length, 0)
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('a discovered run that is unavailable is reported, not replaced', async () => {
  const { audit, registry } = setup()
  const host = mockHost({ settings: { auditRoots: audit, registryHome: registry } })
  const worker = await mountWorker(main, { host })
  const listing = await worker.request('runs.list')
  const missing = listing.runs.find((run) => run.id === 'missing')
  assert.ok(missing)
  assert.equal(missing.availability, 'unavailable')
  assert.equal(missing.problem, 'missing')
  await worker.deactivate()
})

test('the shipped sample audit root is runnable, including its corrupt demo', async () => {
  const sampleRoot = fileURLToPath(new URL('../samples/audit-root', import.meta.url))
  const host = mockHost({ settings: { auditRoots: sampleRoot, registryHome: '' } })
  const worker = await mountWorker(main, { host })
  const listing = await worker.request('runs.list')
  assert.equal(listing.configured, true)
  assert.equal(listing.rootProblems.length, 0)
  assert.ok(
    listing.runs.some((run) => run.id === 'demo-active' && run.availability === 'available')
  )
  assert.ok(
    listing.runs.some((run) => run.id === 'demo-finished' && run.availability === 'available')
  )
  assert.ok(
    listing.runs.some((run) => run.id === 'demo-corrupt' && run.availability === 'corrupt')
  )

  const active = await worker.request('run.get', { runId: 'demo-active' })
  assert.equal(active.mode, 'DEMO')
  assert.equal(active.taskCounts.total, 4)
  assert.equal(active.deliveryCounts.implemented.yes, 1)
  assert.equal(active.deliveryCounts.implemented.no, 1)
  assert.equal(active.deliveryCounts.implemented.unverified, 2)
  await rejects(worker.request('run.get', { runId: 'demo-corrupt' }), 'run_corrupt')
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})
