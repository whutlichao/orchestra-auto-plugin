// Discovery and path-safety tests. Every temp tree is outside a repository and
// is created under a real path, so the symlink checks under test are real.
import { afterEach, assert, test } from 'orca/testing'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_SNAPSHOT_BYTES } from './contract'
import { discoverRuns, lookupRun } from './discovery'

const bases: string[] = []

afterEach(() => {
  for (const base of bases.splice(0)) rmSync(base, { recursive: true, force: true })
})

function fixture(name: string): string {
  return readFileSync(new URL('../test/fixtures/' + name, import.meta.url), 'utf8')
}

function base(): string {
  const value = mkdtempSync(join(realpathSync(tmpdir()), 'orca-discovery-'))
  bases.push(value)
  return value
}

function writeRun(dir: string, raw = fixture('real-active/progress.json')): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'progress.json'), raw)
}

function writeDescriptor(home: string, file: string, value: unknown): void {
  const runs = join(home, 'runs')
  mkdirSync(runs, { recursive: true })
  writeFileSync(join(runs, file), JSON.stringify(value))
}

test('merges the registry and audit roots, and refuses every escape', () => {
  const root = base()
  const audit = join(root, 'audit')
  const registry = join(root, 'registry')
  const outside = join(root, 'outside')
  writeRun(join(audit, 'run-a'), fixture('real-active/progress.json'))
  writeRun(join(audit, 'run-b'), fixture('real-finished/progress.json'))
  writeRun(join(audit, 'broken'), '{"schema_version": 2, "run":')
  mkdirSync(join(audit, 'link-file'), { recursive: true })
  symlinkSync(join(audit, 'run-a', 'progress.json'), join(audit, 'link-file', 'progress.json'))
  symlinkSync(join(audit, 'run-a'), join(audit, 'link-state'))
  mkdirSync(join(audit, 'not-a-run'), { recursive: true })
  writeRun(join(outside, 'state'), fixture('real-finished/progress.json'))

  writeDescriptor(registry, 'fixture-active.json', {
    run_id: 'fixture-active',
    state_path: join(audit, 'run-a'),
    registered_at: '2026-11-03T00:00:00+00:00',
    label: 'From registry'
  })
  writeDescriptor(registry, 'fixture-finished.json', {
    run_id: 'fixture-finished',
    state_path: join(audit, 'run-b'),
    registered_at: '2026-11-03T00:00:00+00:00',
    label: ''
  })
  writeDescriptor(registry, 'outside.json', {
    run_id: 'outside',
    state_path: join(outside, 'state'),
    label: 'Outside'
  })
  writeDescriptor(registry, 'missing.json', {
    run_id: 'missing',
    state_path: join(audit, 'does-not-exist'),
    label: 'Missing'
  })
  writeDescriptor(registry, 'broken-run.json', {
    run_id: 'broken-run',
    state_path: join(audit, 'broken'),
    label: 'Broken'
  })
  writeDescriptor(registry, 'link-state.json', {
    run_id: 'link-state',
    state_path: join(audit, 'link-state'),
    label: 'Linked state'
  })
  writeDescriptor(registry, 'bad-run.json', {
    run_id: 'different-id',
    state_path: join(audit, 'run-a')
  })
  symlinkSync(
    join(registry, 'runs', 'fixture-active.json'),
    join(registry, 'runs', 'link-descriptor.json')
  )

  const result = discoverRuns({ auditRoots: audit, registryHome: registry })
  const listing = result.listing
  assert.equal(listing.configured, true)
  assert.equal(listing.rootProblems.length, 0)
  assert.equal(listing.runs.length, 10)

  const byId = new Map(listing.runs.map((run) => [run.id, run]))
  const active = byId.get('fixture-active')
  assert.ok(active)
  assert.equal(active.label, 'From registry')
  assert.equal(active.source, 'registry')
  assert.equal(active.availability, 'available')
  assert.equal(active.taskCount, 5)

  const finished = byId.get('fixture-finished')
  assert.ok(finished)
  assert.equal(finished.source, 'registry')
  assert.equal(finished.status, 'completed')
  assert.equal(finished.taskCount, 1)

  const brokenScan = byId.get('broken')
  assert.ok(brokenScan)
  assert.equal(brokenScan.availability, 'corrupt')
  assert.equal(brokenScan.problem, 'invalid_json')

  const brokenRegistration = byId.get('broken-run')
  assert.ok(brokenRegistration)
  assert.equal(brokenRegistration.availability, 'corrupt')
  assert.equal(brokenRegistration.problem, 'invalid_json')

  const linkFile = byId.get('link-file')
  assert.ok(linkFile)
  assert.equal(linkFile.problem, 'symlink')

  const linkState = byId.get('link-state')
  assert.ok(linkState)
  assert.equal(linkState.problem, 'symlink')

  const outsideRun = byId.get('outside')
  assert.ok(outsideRun)
  assert.equal(outsideRun.problem, 'outside_audit_roots')

  const missing = byId.get('missing')
  assert.ok(missing)
  assert.equal(missing.problem, 'missing')

  const bad = byId.get('bad-run')
  assert.ok(bad)
  assert.equal(bad.problem, 'invalid_descriptor')

  const linkDescriptor = byId.get('link-descriptor')
  assert.ok(linkDescriptor)
  assert.equal(linkDescriptor.problem, 'symlink')

  assert.equal(byId.has('not-a-run'), false)

  const lookupActive = lookupRun(result, 'fixture-active')
  assert.equal(lookupActive.ok, true)
  if (lookupActive.ok) {
    assert.equal(lookupActive.view.source, 'registry')
    assert.equal(lookupActive.view.id, 'fixture-active')
  }
  const lookupOutside = lookupRun(result, 'outside')
  assert.equal(lookupOutside.ok, false)
  if (!lookupOutside.ok) assert.equal(lookupOutside.code, 'run_unavailable')
  const lookupBroken = lookupRun(result, 'broken')
  assert.equal(lookupBroken.ok, false)
  if (!lookupBroken.ok) assert.equal(lookupBroken.code, 'run_corrupt')
  const lookupMissing = lookupRun(result, 'nope')
  assert.equal(lookupMissing.ok, false)
  if (!lookupMissing.ok) assert.equal(lookupMissing.code, 'run_not_found')
  const lookupTraversal = lookupRun(result, '../etc')
  assert.equal(lookupTraversal.ok, false)
  if (!lookupTraversal.ok) assert.equal(lookupTraversal.code, 'invalid_run_id')
  const lookupAbsolute = lookupRun(result, '/etc')
  assert.equal(lookupAbsolute.ok, false)
  if (!lookupAbsolute.ok) assert.equal(lookupAbsolute.code, 'invalid_run_id')

  const serialized = JSON.stringify(listing)
  assert.equal(serialized.includes(root), false)
  assert.equal(serialized.includes(audit), false)
  assert.equal(serialized.includes(registry), false)
  assert.equal(serialized.includes('/Users/'), false)
})

test('unconfigured settings read no registry and list nothing', () => {
  const root = base()
  const registry = join(root, 'registry')
  writeDescriptor(registry, 'fixture-active.json', {
    run_id: 'fixture-active',
    state_path: join(root, 'audit', 'run-a')
  })
  const result = discoverRuns({ auditRoots: '', registryHome: registry })
  assert.equal(result.listing.configured, false)
  assert.equal(result.listing.runs.length, 0)
  assert.equal(result.entries.size, 0)
  assert.deepEqual(result.listing.warnings, [])
})

test('invalid roots are reported by index, not by path', () => {
  const root = base()
  const missingRoot = join(root, 'missing-root')
  const result = discoverRuns({
    auditRoots: missingRoot + '\nrelative/path\n/\n',
    registryHome: ''
  })
  assert.equal(result.listing.configured, true)
  assert.equal(result.listing.runs.length, 0)
  assert.equal(result.listing.rootProblems.length, 3)
  assert.deepEqual(
    result.listing.rootProblems.map((problem) => problem.index),
    [1, 2, 3]
  )
  const serialized = JSON.stringify(result.listing)
  assert.equal(serialized.includes(missingRoot), false)
  assert.equal(serialized.includes('relative/path'), false)
})

test('an audit root that is itself a run works, including a symlinked snapshot', () => {
  const root = base()
  const run = join(root, 'single-run')
  writeRun(run, fixture('real-finished/progress.json'))
  const direct = discoverRuns({ auditRoots: run, registryHome: '' })
  assert.equal(direct.listing.runs.length, 1)
  assert.equal(direct.listing.runs[0].id, 'fixture-finished')

  const linked = join(root, 'linked-run')
  mkdirSync(linked, { recursive: true })
  symlinkSync(join(run, 'progress.json'), join(linked, 'progress.json'))
  const refused = discoverRuns({ auditRoots: linked, registryHome: '' })
  assert.equal(refused.listing.runs.length, 1)
  assert.equal(refused.listing.runs[0].availability, 'unavailable')
  assert.equal(refused.listing.runs[0].problem, 'symlink')
})

test('oversized snapshots are refused without being read', () => {
  const root = base()
  const huge = join(root, 'huge')
  mkdirSync(huge, { recursive: true })
  writeFileSync(join(huge, 'progress.json'), '')
  truncateSync(join(huge, 'progress.json'), MAX_SNAPSHOT_BYTES + 1)
  const result = discoverRuns({ auditRoots: root, registryHome: '' })
  const summary = result.listing.runs.find((run) => run.id === 'huge')
  assert.ok(summary)
  assert.equal(summary.availability, 'corrupt')
  assert.equal(summary.problem, 'too_large')
})

test('duplicate scan IDs keep one entry and warn', () => {
  const root = base()
  const first = join(root, 'first')
  const second = join(root, 'second')
  writeRun(join(first, 'same-id'))
  writeRun(join(second, 'same-id'))
  const result = discoverRuns({ auditRoots: first + '\n' + second, registryHome: '' })
  assert.equal(result.listing.runs.filter((run) => run.id === 'fixture-active').length, 1)
  assert.ok(
    result.listing.warnings.some((warning) => warning.includes('重复 Run ID'))
  )
})

test('a registry ID that differs from the state run.id is visible as a warning', () => {
  const root = base()
  const audit = join(root, 'audit')
  const registry = join(root, 'registry')
  writeRun(join(audit, 'run-a'))
  writeDescriptor(registry, 'mismatch.json', {
    run_id: 'mismatch',
    state_path: join(audit, 'run-a'),
    label: 'Mismatch'
  })
  const result = discoverRuns({ auditRoots: audit, registryHome: registry })
  const summary = result.listing.runs.find((run) => run.id === 'mismatch')
  assert.ok(summary)
  assert.equal(summary.label, 'Mismatch')
  assert.ok(
    result.listing.warnings.some((warning) => warning.includes('run.id 不一致'))
  )
  const lookup = lookupRun(result, 'mismatch')
  assert.equal(lookup.ok, true)
  if (lookup.ok) assert.equal(lookup.view.id, 'fixture-active')
})
