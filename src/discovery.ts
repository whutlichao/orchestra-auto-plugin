// Read-only discovery of orchestra-auto runs.
//
// Two sources are allowed, and a state directory must live under one of the
// configured audit roots before any file inside it is touched:
//   1. progress registry descriptors (default ~/.orca/progress/runs)
//   2. one-level scan of each audit root, plus the root itself when it directly
//      contains progress.json
//
// The module never accepts a path from the panel, never follows a symbolic
// link, never writes, and never returns a state directory to the panel.

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync
} from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, parse as parsePath, relative, resolve, sep } from 'node:path'
import {
  MAX_SNAPSHOT_BYTES,
  PROBLEM_TEXT,
  SnapshotError,
  isPortableId,
  isRecord,
  labelFor,
  parseSnapshot,
  projectRun,
  type RunAvailability,
  type RunListing,
  type RunMode,
  type RunProblemCode,
  type RunSource,
  type RunStatus,
  type RunSummary,
  type RunView,
  type RootProblem
} from './contract'

const MAX_ROOTS = 16
const MAX_REGISTRY_FILES = 200
const MAX_SCAN_DIRS = 1000
const MAX_RUNS = 200
const MAX_DISCOVERY_BYTES = 64 * 1024 * 1024
const MAX_DESCRIPTOR_BYTES = 64 * 1024
const DESCRIPTOR_FIELDS = new Set(['run_id', 'state_path', 'registered_at', 'label'])
const CORRUPT_PROBLEMS = new Set<RunProblemCode>([
  'invalid_json',
  'unsupported_schema',
  'invalid_shape',
  'too_large'
])

const NO_FOLLOW = (constants as Record<string, number>).O_NOFOLLOW ?? 0

export type DiscoverySettings = {
  auditRoots: unknown
  registryHome: unknown
}

export type RunEntry = {
  summary: RunSummary
  stateDir: string | null
  view: RunView | null
}

export type DiscoveryResult = {
  listing: RunListing
  entries: Map<string, RunEntry>
}

export type RunLookup =
  | { ok: true; view: RunView }
  | {
      ok: false
      code: 'invalid_run_id' | 'run_not_found' | 'run_corrupt' | 'run_unavailable'
      message: string
    }

class SafetyError extends Error {
  readonly code: RunProblemCode

  constructor(code: RunProblemCode, message: string) {
    super(message)
    this.name = 'SafetyError'
    this.code = code
  }
}

class BudgetExceeded extends Error {}

type ScanContext = {
  now: number
  roots: string[]
  warnings: string[]
  rootProblems: RootProblem[]
  truncated: boolean
  bytesRead: number
  stop: boolean
}

type Descriptor = {
  id: string
  label: string
  statePath: string
}

function fsCode(error: unknown): string {
  return isRecord(error) && typeof error.code === 'string' ? error.code : ''
}

function readError(error: unknown): SafetyError {
  const code = fsCode(error)
  if (code === 'ENOENT') return new SafetyError('missing', 'file is missing')
  if (code === 'ELOOP') return new SafetyError('symlink', 'symbolic link is not allowed')
  if (code === 'EACCES' || code === 'EPERM') return new SafetyError('unreadable', 'file is not readable')
  return new SafetyError('unreadable', 'file is not readable')
}

function expandUser(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/')) return join(homedir(), trimmed.slice(2))
  return trimmed
}

function absolutePath(raw: string): string {
  if (raw.includes('\0')) throw new SafetyError('invalid_path', 'path contains a NUL byte')
  const expanded = expandUser(raw)
  if (expanded === '') throw new SafetyError('invalid_path', 'path is empty')
  if (!isAbsolute(expanded)) throw new SafetyError('invalid_path', 'path must be absolute')
  return resolve(expanded)
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))
}

function assertNoSymlinkComponents(path: string): void {
  const root = parsePath(path).root
  let current = root
  for (const part of path.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part)
    let stat
    try {
      stat = lstatSync(current)
    } catch (error) {
      throw readError(error)
    }
    if (stat.isSymbolicLink()) {
      throw new SafetyError('symlink', 'path contains a symbolic link')
    }
  }
}

function resolveRoot(raw: string): string {
  let path: string
  try {
    path = absolutePath(raw)
  } catch (error) {
    throw new SafetyError('invalid_path', reasonForRoot(error))
  }
  if (path === parsePath(path).root || path === resolve(homedir())) {
    throw new SafetyError('invalid_path', '审计目录不能是文件系统根目录或用户主目录')
  }
  try {
    assertNoSymlinkComponents(path)
    const real = realpathSync(path)
    const stat = statSync(real)
    if (!stat.isDirectory()) throw new SafetyError('invalid_path', '审计目录不是目录')
    if (!isInside(path, real) && path !== real) {
      throw new SafetyError('symlink', '审计目录解析后越过了配置的路径')
    }
    return real
  } catch (error) {
    if (error instanceof SafetyError) {
      if (error.code === 'missing') throw new SafetyError('invalid_path', '审计目录不存在')
      throw error
    }
    throw new SafetyError('unreadable', reasonForRoot(error))
  }
}

function reasonForRoot(error: unknown): string {
  if (error instanceof SafetyError) {
    if (error.code === 'missing') return '目录不存在'
    if (error.code === 'symlink') return '路径包含符号链接'
    if (error.code === 'invalid_path') return error.message
    if (error.code === 'outside_audit_roots') return '路径不在审计目录内'
    return '目录不可读'
  }
  return '目录不可读'
}

function parseRoots(raw: unknown, ctx: ScanContext): void {
  if (typeof raw !== 'string') return
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length > MAX_ROOTS) {
    ctx.truncated = true
    ctx.warnings.push('审计目录超过 ' + MAX_ROOTS + ' 个；只使用前 ' + MAX_ROOTS + ' 个')
  }
  const seen = new Set<string>()
  lines.slice(0, MAX_ROOTS).forEach((line, index) => {
    try {
      const root = resolveRoot(line)
      if (seen.has(root)) {
        ctx.warnings.push('审计目录有重复项，已忽略重复的目录')
        return
      }
      seen.add(root)
      ctx.roots.push(root)
    } catch (error) {
      const reason = error instanceof SafetyError ? reasonForRoot(error) : '目录不可读'
      ctx.rootProblems.push({ index: index + 1, reason })
    }
  })
}

function resolveStatePath(raw: string, roots: string[]): string {
  const path = absolutePath(raw)
  const lexical = roots.some((root) => isInside(root, path))
  if (!lexical) {
    throw new SafetyError('outside_audit_roots', 'state path is outside every audit root')
  }
  assertNoSymlinkComponents(path)
  const real = realpathSync(path)
  if (!roots.some((root) => isInside(root, real))) {
    throw new SafetyError('outside_audit_roots', 'state path resolves outside every audit root')
  }
  let stat
  try {
    stat = statSync(real)
  } catch (error) {
    throw readError(error)
  }
  if (!stat.isDirectory()) throw new SafetyError('unreadable', 'state path is not a directory')
  return real
}

function readTextFile(path: string, maxBytes: number): string {
  let fd: number
  try {
    fd = openSync(path, constants.O_RDONLY | NO_FOLLOW)
  } catch (error) {
    throw readError(error)
  }
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) throw new SafetyError('unreadable', 'not a regular file')
    if (stat.size > maxBytes) throw new SafetyError('too_large', 'file is larger than the read limit')
    const buffer = Buffer.alloc(stat.size)
    let read = 0
    while (read < stat.size) {
      const count = readSync(fd, buffer, read, stat.size - read, read)
      if (count <= 0) break
      read += count
    }
    if (read !== stat.size) throw new SafetyError('unreadable', 'file changed while reading')
    return buffer.toString('utf8')
  } catch (error) {
    if (error instanceof SafetyError) throw error
    throw readError(error)
  } finally {
    closeSync(fd)
  }
}

function readDescriptor(path: string, stem: string): Descriptor {
  let raw: string
  try {
    raw = readTextFile(path, MAX_DESCRIPTOR_BYTES)
  } catch (error) {
    if (error instanceof SafetyError && error.code === 'symlink') throw error
    throw new SafetyError('invalid_descriptor', 'descriptor is not readable')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new SafetyError('invalid_descriptor', 'descriptor is not valid JSON')
  }
  if (!isRecord(parsed)) {
    throw new SafetyError('invalid_descriptor', 'descriptor is not an object')
  }
  for (const key of Object.keys(parsed)) {
    if (!DESCRIPTOR_FIELDS.has(key)) {
      throw new SafetyError('invalid_descriptor', 'descriptor has unknown fields')
    }
  }
  if (!isPortableId(parsed.run_id) || parsed.run_id !== stem) {
    throw new SafetyError('invalid_descriptor', 'descriptor run_id does not match its file name')
  }
  if (parsed.label !== undefined && typeof parsed.label !== 'string') {
    throw new SafetyError('invalid_descriptor', 'descriptor label is not a string')
  }
  if (parsed.registered_at !== undefined &&
      (typeof parsed.registered_at !== 'string' || parsed.registered_at === '')) {
    throw new SafetyError('invalid_descriptor', 'descriptor registered_at is invalid')
  }
  if (typeof parsed.state_path !== 'string' || parsed.state_path === '') {
    throw new SafetyError('invalid_descriptor', 'descriptor state_path is missing')
  }
  return {
    id: parsed.run_id,
    label: typeof parsed.label === 'string' ? parsed.label : '',
    statePath: parsed.state_path
  }
}

function probeProgress(dir: string): 'file' | 'symlink' | 'other' | 'missing' | 'unreadable' {
  try {
    const stat = lstatSync(join(dir, 'progress.json'))
    if (stat.isSymbolicLink()) return 'symlink'
    if (stat.isFile()) return 'file'
    return 'other'
  } catch (error) {
    return fsCode(error) === 'ENOENT' ? 'missing' : 'unreadable'
  }
}

function summaryFor(
  id: string,
  label: string,
  source: RunSource,
  availability: RunAvailability,
  problem: RunProblemCode | null,
  view?: RunView
): RunSummary {
  return {
    id,
    label,
    source,
    availability,
    problem,
    status: (view?.status ?? 'unknown') as RunStatus,
    health: view?.health ?? 'unknown',
    mode: (view?.mode ?? 'unknown') as RunMode,
    phase: view?.phase ?? '',
    observedAt: view?.lastObservedAt ?? null,
    endedAt: view?.endedAt ?? null,
    taskCount: view?.taskCounts.total ?? 0
  }
}

function setEntry(
  entries: Map<string, RunEntry>,
  entry: RunEntry,
  ctx: ScanContext,
  override: boolean
): void {
  const existing = entries.get(entry.summary.id)
  if (!existing) {
    entries.set(entry.summary.id, entry)
    return
  }
  if (override) {
    entries.set(entry.summary.id, entry)
    return
  }
  if (existing.summary.source === 'registry') return
  ctx.warnings.push('审计目录中有重复 Run ID：' + entry.summary.id + '；只保留一个')
}

function addUnavailable(
  entries: Map<string, RunEntry>,
  id: string,
  label: string,
  source: RunSource,
  problem: RunProblemCode,
  ctx: ScanContext,
  override: boolean
): void {
  if (!isPortableId(id)) {
    ctx.warnings.push('审计目录中有不可读的运行，目录名不能作为 Run ID')
    return
  }
  setEntry(
    entries,
    {
      summary: summaryFor(
        id,
        label || id,
        source,
        CORRUPT_PROBLEMS.has(problem) ? 'corrupt' : 'unavailable',
        problem
      ),
      stateDir: null,
      view: null
    },
    ctx,
    override
  )
}

function readSnapshotAt(dir: string, source: RunSource, ctx: ScanContext): RunView {
  // `dir` was resolved to a real path during discovery. If it no longer
  // resolves to itself, a component was swapped for a symlink between the
  // containment check and the read; refuse instead of following it.
  let stable: string
  try {
    stable = realpathSync(dir)
  } catch (error) {
    throw readError(error)
  }
  if (stable !== dir) throw new SafetyError('symlink', 'state directory changed while reading')
  const path = join(dir, 'progress.json')
  let stat
  try {
    stat = lstatSync(path)
  } catch (error) {
    throw readError(error)
  }
  if (stat.isSymbolicLink()) throw new SafetyError('symlink', 'progress.json is a symbolic link')
  if (!stat.isFile()) throw new SafetyError('unreadable', 'progress.json is not a regular file')
  if (stat.size > MAX_SNAPSHOT_BYTES) {
    throw new SafetyError('too_large', 'progress.json is larger than the read limit')
  }
  if (ctx.bytesRead + stat.size > MAX_DISCOVERY_BYTES) {
    ctx.truncated = true
    ctx.stop = true
    ctx.warnings.push('本次读取达到 64 MiB 上限；部分运行未列出')
    throw new BudgetExceeded()
  }
  ctx.bytesRead += stat.size
  const raw = readTextFile(path, MAX_SNAPSHOT_BYTES)
  const snapshot = parseSnapshot(raw)
  return projectRun(snapshot, { source, now: ctx.now })
}

function addRun(
  entries: Map<string, RunEntry>,
  stateDir: string,
  source: RunSource,
  labelHint: string,
  idHint: string | null,
  ctx: ScanContext,
  override: boolean
): void {
  let view: RunView
  try {
    view = readSnapshotAt(stateDir, source, ctx)
  } catch (error) {
    if (error instanceof BudgetExceeded) throw error
    const fallbackId = idHint ?? ''
    if (!fallbackId) throw error
    const problem = error instanceof SafetyError
      ? error.code
      : error instanceof SnapshotError
        ? error.code
        : 'unreadable'
    addUnavailable(entries, fallbackId, labelHint, source, problem, ctx, override)
    return
  }
  const id = idHint ?? view.id
  if (idHint && idHint !== view.id) {
    view.warnings.push('注册表 Run ID 与快照 run.id 不一致')
    ctx.warnings.push('注册表 Run ID 与快照 run.id 不一致：' + idHint)
  }
  setEntry(
    entries,
    {
      summary: summaryFor(id, labelFor(view, labelHint), source, 'available', null, view),
      stateDir,
      view
    },
    ctx,
    override
  )
}

function scanRoot(
  root: string,
  entries: Map<string, RunEntry>,
  ctx: ScanContext
): void {
  const rootProbe = probeProgress(root)
  if (rootProbe !== 'missing') {
    const name = parsePath(root).base
    if (rootProbe === 'file') {
      try {
        addRun(entries, root, 'audit-root', '', null, ctx, false)
      } catch (error) {
        if (error instanceof BudgetExceeded) return
        const problem = error instanceof SafetyError || error instanceof SnapshotError
          ? error.code
          : 'unreadable'
        addUnavailable(entries, name, name, 'audit-root', problem, ctx, false)
      }
    } else {
      addUnavailable(
        entries,
        name,
        name,
        'audit-root',
        rootProbe === 'symlink' ? 'symlink' : 'unreadable',
        ctx,
        false
      )
    }
  }

  let dirents
  try {
    dirents = readdirSync(root, { withFileTypes: true })
  } catch {
    ctx.warnings.push('审计目录读取失败；已跳过该目录')
    return
  }
  dirents.sort((a, b) => a.name.localeCompare(b.name))
  let scanned = 0
  for (const dirent of dirents) {
    if (scanned >= MAX_SCAN_DIRS) {
      ctx.truncated = true
      ctx.warnings.push('审计目录条目超过 ' + MAX_SCAN_DIRS + ' 个；部分目录未扫描')
      break
    }
    scanned += 1
    if (dirent.name.startsWith('.')) continue
    if (dirent.isSymbolicLink() || !dirent.isDirectory()) continue
    const child = join(root, dirent.name)
    const probe = probeProgress(child)
    if (probe === 'missing') continue
    if (probe === 'file') {
      try {
        addRun(entries, child, 'audit-root', '', null, ctx, false)
      } catch (error) {
        if (error instanceof BudgetExceeded) return
        const problem = error instanceof SafetyError || error instanceof SnapshotError
          ? error.code
          : 'unreadable'
        addUnavailable(entries, dirent.name, dirent.name, 'audit-root', problem, ctx, false)
      }
      continue
    }
    addUnavailable(
      entries,
      dirent.name,
      dirent.name,
      'audit-root',
      probe === 'symlink' ? 'symlink' : 'unreadable',
      ctx,
      false
    )
  }
}

function collectRegistry(
  raw: unknown,
  entries: Map<string, RunEntry>,
  ctx: ScanContext
): void {
  if (typeof raw !== 'string' || raw.trim() === '') return
  let home: string
  try {
    home = resolveRoot(raw)
  } catch {
    ctx.warnings.push('progress 注册表不可用；仅显示审计目录中的运行')
    return
  }
  const runsDir = join(home, 'runs')
  let stat
  try {
    stat = lstatSync(runsDir)
  } catch (error) {
    ctx.warnings.push(
      fsCode(error) === 'ENOENT'
        ? 'progress 注册表没有 runs 目录；仅显示审计目录中的运行'
        : 'progress 注册表不可用；仅显示审计目录中的运行'
    )
    return
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    ctx.warnings.push('progress 注册表不可用；仅显示审计目录中的运行')
    return
  }
  let names
  try {
    names = readdirSync(runsDir).filter((name) => name.endsWith('.json')).sort()
  } catch {
    ctx.warnings.push('progress 注册表不可读；仅显示审计目录中的运行')
    return
  }
  if (names.length > MAX_REGISTRY_FILES) {
    ctx.truncated = true
    ctx.warnings.push('注册表条目超过 ' + MAX_REGISTRY_FILES + ' 个；只读取前 ' + MAX_REGISTRY_FILES + ' 个')
    names = names.slice(0, MAX_REGISTRY_FILES)
  }
  for (const name of names) {
    const stem = name.slice(0, -'.json'.length)
    if (!isPortableId(stem)) {
      ctx.warnings.push('注册表中有文件名不是 Run ID 的描述文件，已跳过')
      continue
    }
    try {
      const descriptor = readDescriptor(join(runsDir, name), stem)
      const stateDir = resolveStatePath(descriptor.statePath, ctx.roots)
      addRun(entries, stateDir, 'registry', descriptor.label, descriptor.id, ctx, true)
    } catch (error) {
      if (error instanceof BudgetExceeded) return
      const problem = error instanceof SafetyError || error instanceof SnapshotError
        ? error.code
        : 'invalid_descriptor'
      addUnavailable(entries, stem, stem, 'registry', problem, ctx, true)
    }
  }
}

/**
 * Discover every run reachable through the configured settings.
 *
 * The returned listing is safe to send to a panel: it has no state paths and no
 * target repository paths. The entries map is internal and never serialized.
 */
export function discoverRuns(settings: DiscoverySettings): DiscoveryResult {
  const now = Date.now()
  const configured = typeof settings.auditRoots === 'string' && settings.auditRoots.trim() !== ''
  const ctx: ScanContext = {
    now,
    roots: [],
    warnings: [],
    rootProblems: [],
    truncated: false,
    bytesRead: 0,
    stop: false
  }
  if (configured) {
    parseRoots(settings.auditRoots, ctx)
  }

  const entries = new Map<string, RunEntry>()
  if (configured && ctx.roots.length > 0) {
    for (const root of ctx.roots) {
      scanRoot(root, entries, ctx)
      if (ctx.stop) break
    }
    if (!ctx.stop) collectRegistry(settings.registryHome, entries, ctx)
  } else if (configured) {
    ctx.warnings.push('没有可用的审计目录；未读取注册表')
  }

  const runs = [...entries.values()].map((entry) => entry.summary)
  runs.sort((a, b) => {
    const rank = (run: RunSummary) => (run.availability === 'available' ? 0 : 1)
    return rank(a) - rank(b) ||
      (b.observedAt ?? -1) - (a.observedAt ?? -1) ||
      a.label.localeCompare(b.label) ||
      a.id.localeCompare(b.id)
  })
  if (runs.length > MAX_RUNS) {
    ctx.truncated = true
    ctx.warnings.push('运行数量超过 ' + MAX_RUNS + ' 个；只列出前 ' + MAX_RUNS + ' 个')
    runs.length = MAX_RUNS
  }
  const problems = runs.filter((run) => run.availability !== 'available').length
  if (problems > 0) {
    ctx.warnings.push('有 ' + problems + ' 个运行不可用或损坏')
  }
  const warnings = [...new Set(ctx.warnings)]
  return {
    listing: {
      configured,
      runs,
      warnings,
      rootProblems: ctx.rootProblems,
      truncated: ctx.truncated,
      scannedAt: now
    },
    entries
  }
}

export function lookupRun(result: DiscoveryResult, runId: unknown): RunLookup {
  if (!isPortableId(runId)) {
    return { ok: false, code: 'invalid_run_id', message: '运行 ID 无效' }
  }
  const entry = result.entries.get(runId)
  if (!entry) {
    return { ok: false, code: 'run_not_found', message: '没有这个运行' }
  }
  if (entry.view) return { ok: true, view: entry.view }
  const problem = entry.summary.problem
  const message = problem ? PROBLEM_TEXT[problem] : '运行不可用'
  return {
    ok: false,
    code: problem && CORRUPT_PROBLEMS.has(problem) ? 'run_corrupt' : 'run_unavailable',
    message
  }
}
