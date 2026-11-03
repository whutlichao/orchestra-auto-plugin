// Deterministic view fixtures for `orca plugin check` and the panel tests.
// They are not loaded by the panel or the worker in normal use.
import type { RunListing, RunSummary, RunView } from './contract'

const observed = Date.UTC(2026, 10, 3, 11, 55, 0)
const started = Date.UTC(2026, 10, 3, 8, 0, 0)
const staleObserved = Date.UTC(2026, 10, 3, 10, 0, 0)

const task = (
  id: string,
  title: string,
  status: RunView['tasks'][number]['status'],
  overrides: Partial<RunView['tasks'][number]> = {}
) => ({
  id,
  title,
  status,
  dependencies: [],
  blockedReason: '',
  pendingDecision: '',
  provisional: false,
  orcaTaskId: null,
  ...overrides
})

const worker = (
  id: string,
  taskId: string,
  overrides: Partial<RunView['workers'][number]> = {}
) => ({
  id,
  taskId,
  dispatchId: 'd-' + id,
  attempt: 1,
  parentWorkerId: null,
  lifecycle: 'running' as const,
  reportedLifecycle: 'unknown' as const,
  startConfirmation: 'observed' as const,
  reportedSummary: '',
  worktree: 'demo-worktree',
  lastObservedAt: observed,
  freshness: 'current' as const,
  ...overrides
})

export const sampleView: RunView = {
  id: 'demo-active',
  title: '示例：只读观测面板',
  source: 'audit-root',
  schemaVersion: 2,
  status: 'active',
  health: 'degraded',
  mode: 'DEMO',
  phase: 'implementation',
  summary:
    '演示数据：包含运行中的任务、阻塞与待决事项、失联 Worker，以及 true/false/未核验三种交付事实。',
  orcaRunId: 'run_demo00000000',
  startedAt: started,
  lastObservedAt: observed,
  lastEffectiveProgressAt: observed,
  endedAt: null,
  freshness: 'current',
  tasks: [
    task('t-plan', '协议与面板设计', 'accepted'),
    task('t-panel', '实现只读面板', 'running', { dependencies: ['t-plan'] }),
    task('t-api', '等待审计目录权限', 'blocked', {
      dependencies: ['t-plan'],
      blockedReason: '需要用户确认审计目录'
    }),
    task('t-docs', '安装与使用文档', 'waiting_user', {
      pendingDecision: '是否同时发布到 Git 安装源？'
    }),
    task('t-old', '旧方案：直读注册表二进制', 'rejected', {
      blockedReason: '方向不符合只读约束'
    }),
    task('t-extra', '补充路径安全测试', 'pending', { dependencies: ['t-panel'] })
  ],
  taskCounts: {
    unknown: 0,
    pending: 1,
    ready: 0,
    running: 1,
    blocked: 1,
    waiting_user: 1,
    reported: 0,
    accepted: 1,
    rejected: 1,
    failed: 0,
    paused: 0,
    cancelled: 0,
    total: 6
  },
  workerTotal: 5,
  workers: [
    worker('w-plan-a1', 't-plan', {
      lifecycle: 'closed',
      reportedLifecycle: 'reported_done',
      reportedSummary: '设计完成，等待验收。'
    }),
    worker('w-panel-a1', 't-panel'),
    worker('w-api-a1', 't-api', {
      lifecycle: 'lost',
      lastObservedAt: staleObserved,
      freshness: 'stale'
    }),
    worker('w-docs-a1', 't-docs', {
      lifecycle: 'waiting_user',
      startConfirmation: 'unobserved'
    }),
    worker('w-old-a1', 't-old', {
      lifecycle: 'failed',
      reportedLifecycle: 'failed',
      startConfirmation: 'unknown',
      lastObservedAt: staleObserved,
      freshness: 'stale'
    })
  ],
  deliveryTotal: 6,
  deliveries: [
    {
      taskId: 't-api',
      recorded: true,
      implemented: null,
      integrated: null,
      merged: null,
      trackerClosed: null,
      evidenceCount: 0
    },
    {
      taskId: 't-docs',
      recorded: false,
      implemented: null,
      integrated: null,
      merged: null,
      trackerClosed: null,
      evidenceCount: 0
    },
    {
      taskId: 't-extra',
      recorded: false,
      implemented: null,
      integrated: null,
      merged: null,
      trackerClosed: null,
      evidenceCount: 0
    },
    {
      taskId: 't-old',
      recorded: true,
      implemented: false,
      integrated: false,
      merged: false,
      trackerClosed: false,
      evidenceCount: 1
    },
    {
      taskId: 't-panel',
      recorded: true,
      implemented: false,
      integrated: null,
      merged: null,
      trackerClosed: null,
      evidenceCount: 0
    },
    {
      taskId: 't-plan',
      recorded: true,
      implemented: true,
      integrated: true,
      merged: true,
      trackerClosed: false,
      evidenceCount: 2
    }
  ],
  deliveryCounts: {
    implemented: { yes: 1, no: 2, unverified: 3 },
    integrated: { yes: 1, no: 1, unverified: 4 },
    merged: { yes: 1, no: 1, unverified: 4 },
    tracker_closed: { yes: 0, no: 2, unverified: 4 }
  },
  deliveryMissingTasks: 2,
  artifacts: [
    { id: 'artifact-report', taskId: 't-plan', kind: 'report', label: '验收报告' },
    { id: 'artifact-pr', taskId: 't-panel', kind: 'pr', label: 'PR #123' }
  ],
  artifactTotal: 2,
  events: [
    {
      index: 4,
      id: 'event-4',
      at: observed,
      type: 'worker',
      source: 'coordinator',
      summary: '记录了 panel worker 的启动观察',
      bookkeeping: false
    },
    {
      index: 3,
      id: 'event-3',
      at: observed - 60_000,
      type: 'delivery',
      source: 'coordinator',
      summary: '记录了计划任务的交付事实',
      bookkeeping: false
    },
    {
      index: 2,
      id: 'event-2',
      at: observed - 120_000,
      type: 'event',
      source: 'coordinator',
      summary: '对账回写：补齐 worker 行',
      bookkeeping: true
    },
    {
      index: 1,
      id: 'event-1',
      at: started,
      type: 'init',
      source: 'coordinator',
      summary: 'init recorded',
      bookkeeping: false
    }
  ],
  eventTotal: 4,
  attention: [
    { id: 'task-blocked:t-api', kind: 'blocked', text: '等待审计目录权限：需要用户确认审计目录' },
    { id: 'task-decision:t-docs', kind: 'decision', text: '安装与使用文档：是否同时发布到 Git 安装源？' },
    { id: 'task-rejected:t-old', kind: 'rejected', text: '旧方案：直读注册表二进制：已打回' },
    { id: 'worker-lost:w-api-a1', kind: 'worker-lost', text: 'w-api-a1：Worker 失联' },
    { id: 'worker-failed:w-old-a1', kind: 'worker-failed', text: 'w-old-a1：Worker 失败' }
  ],
  attentionTotal: 5,
  warnings: ['示例数据仅用于界面演示']
}

export const sampleFinishedView: RunView = {
  ...sampleView,
  id: 'demo-finished',
  title: '示例：已完成运行',
  status: 'completed',
  health: 'healthy',
  phase: 'done',
  summary: '演示数据：已结束的运行，交付事实仍以字段为准。',
  endedAt: observed,
  taskCounts: {
    ...sampleView.taskCounts,
    pending: 0,
    running: 0,
    blocked: 0,
    waiting_user: 0,
    rejected: 0,
    failed: 0,
    accepted: 6,
    total: 6
  },
  tasks: sampleView.tasks.map((item) => ({
    ...item,
    status: 'accepted' as const,
    blockedReason: '',
    pendingDecision: ''
  })),
  attention: [],
  attentionTotal: 0,
  warnings: []
}

function summaryOf(view: RunView): RunSummary {
  return {
    id: view.id,
    label: view.title,
    source: 'audit-root',
    availability: 'available',
    problem: null,
    status: view.status,
    health: view.health,
    mode: view.mode,
    observedAt: view.lastObservedAt,
    taskCount: view.taskCounts.total
  }
}

const activeSummary = summaryOf(sampleView)

export const finishedSummary = summaryOf(sampleFinishedView)

export const corruptSummary: RunSummary = {
  id: 'demo-corrupt',
  label: '示例：损坏快照',
  source: 'audit-root' as const,
  availability: 'corrupt' as const,
  problem: 'invalid_json' as const,
  status: 'unknown' as const,
  health: 'unknown' as const,
  mode: 'unknown' as const,
  observedAt: null,
  taskCount: 0
}

export const unavailableSummary: RunSummary = {
  id: 'demo-unavailable',
  label: '示例：不可用运行',
  source: 'registry' as const,
  availability: 'unavailable' as const,
  problem: 'missing' as const,
  status: 'unknown' as const,
  health: 'unknown' as const,
  mode: 'unknown' as const,
  observedAt: null,
  taskCount: 0
}

export const sampleListing: RunListing = {
  configured: true,
  runs: [activeSummary, finishedSummary, corruptSummary, unavailableSummary],
  warnings: ['有 2 个运行不可用或损坏'],
  rootProblems: []
}

export const emptyListing: RunListing = {
  configured: true,
  runs: [],
  warnings: [],
  rootProblems: []
}

export const unconfiguredListing: RunListing = {
  configured: false,
  runs: [],
  warnings: [],
  rootProblems: []
}
