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
  taskId: string | null,
  overrides: Partial<RunView['workers'][number]> = {}
) => ({
  id,
  taskId,
  taskState: (taskId === null ? 'none' : 'recorded') as RunView['workers'][number]['taskState'],
  dispatchId: 'd-' + id,
  attempt: 1,
  parentWorkerId: null,
  parentState: 'none' as const,
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
    '演示数据：协调者下有多层 Worker，包含缺失父节点与无效父关系、阻塞与待决事项、失联 Worker，以及 true/false/未核验三种交付事实。',
  orcaRunId: 'run_demo00000000',
  startedAt: started,
  lastObservedAt: observed,
  lastEffectiveProgressAt: observed,
  endedAt: null,
  freshness: 'current',
  tasks: [
    task('t-plan', '协议与面板设计', 'accepted', { orcaTaskId: 'ot-plan-1' }),
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
    task('t-extra', '补充路径安全测试', 'pending', { dependencies: ['t-panel'] }),
    task('t-unassigned', '未派发 Worker 的收尾任务', 'pending')
  ],
  taskCounts: {
    unknown: 0,
    pending: 2,
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
    total: 7
  },
  workerTotal: 6,
  workers: [
    worker('w-plan-a1', 't-plan', {
      lifecycle: 'closed',
      reportedLifecycle: 'reported_done',
      reportedSummary: '设计完成，等待验收。'
    }),
    worker('w-panel-a1', 't-panel', {
      parentWorkerId: 'w-plan-a1',
      parentState: 'recorded'
    }),
    worker('w-panel-helper', 't-extra', {
      parentWorkerId: 'w-panel-a1',
      parentState: 'recorded',
      reportedSummary: '补充路径测试中。'
    }),
    worker('w-api-a1', 't-api', {
      parentWorkerId: 'w-api-parent-ghost',
      parentState: 'recorded',
      lifecycle: 'lost',
      lastObservedAt: staleObserved,
      freshness: 'stale'
    }),
    worker('w-docs-a1', 't-docs', {
      lifecycle: 'waiting_user',
      startConfirmation: 'unobserved'
    }),
    worker('w-old-a1', 't-old', {
      parentState: 'invalid',
      lifecycle: 'failed',
      reportedLifecycle: 'failed',
      startConfirmation: 'unknown',
      lastObservedAt: staleObserved,
      freshness: 'stale'
    })
  ],
  deliveryTotal: 7,
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
    },
    {
      taskId: 't-unassigned',
      recorded: false,
      implemented: null,
      integrated: null,
      merged: null,
      trackerClosed: null,
      evidenceCount: 0
    }
  ],
  deliveryCounts: {
    implemented: { yes: 1, no: 2, unverified: 4 },
    integrated: { yes: 1, no: 1, unverified: 5 },
    merged: { yes: 1, no: 1, unverified: 5 },
    tracker_closed: { yes: 0, no: 2, unverified: 5 }
  },
  deliveryMissingTasks: 3,
  artifacts: [
    { id: 'artifact-report', taskId: 't-plan', kind: 'report', label: '验收报告' },
    { id: 'artifact-pr', taskId: 't-panel', kind: 'pr', label: 'PR #123' }
  ],
  artifactTotal: 2,
  events: [
    {
      index: 4,
      at: observed,
      type: 'worker',
      source: 'coordinator',
      summary: '记录了 panel worker 的启动观察',
      bookkeeping: false
    },
    {
      index: 3,
      at: observed - 60_000,
      type: 'delivery',
      source: 'coordinator',
      summary: '记录了计划任务的交付事实',
      bookkeeping: false
    },
    {
      index: 2,
      at: observed - 120_000,
      type: 'event',
      source: 'coordinator',
      summary: '对账回写：补齐 worker 行',
      bookkeeping: true
    },
    {
      index: 1,
      at: started,
      type: 'init',
      source: 'coordinator',
      summary: 'init recorded',
      bookkeeping: false
    }
  ],
  eventTotal: 4,
  attention: [
    {
      id: 'task-blocked:t-api',
      kind: 'blocked',
      text: '等待审计目录权限：需要用户确认审计目录',
      taskId: 't-api'
    },
    {
      id: 'task-decision:t-docs',
      kind: 'decision',
      text: '安装与使用文档：是否同时发布到 Git 安装源？',
      taskId: 't-docs'
    },
    {
      id: 'task-rejected:t-old',
      kind: 'rejected',
      text: '旧方案：直读注册表二进制：已打回',
      taskId: 't-old'
    },
    {
      id: 'worker-lost:w-api-a1',
      kind: 'worker-lost',
      text: 'w-api-a1：Worker 失联',
      workerId: 'w-api-a1'
    },
    {
      id: 'worker-failed:w-old-a1',
      kind: 'worker-failed',
      text: 'w-old-a1：Worker 失败',
      workerId: 'w-old-a1'
    }
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
    accepted: 7,
    total: 7
  },
  tasks: sampleView.tasks.map((item) => ({
    ...item,
    status: 'accepted' as const,
    blockedReason: '',
    pendingDecision: ''
  })),
  workers: sampleView.workers.map((item) => {
    const parentId =
      item.id === 'w-panel-a1'
        ? 'w-plan-a1'
        : item.id === 'w-panel-helper'
          ? 'w-panel-a1'
          : null
    return {
      ...item,
      lifecycle: 'closed' as const,
      reportedLifecycle: 'reported_done' as const,
      startConfirmation: 'observed' as const,
      reportedSummary: '已完成并记录。',
      freshness: 'current' as const,
      parentWorkerId: parentId,
      parentState: parentId ? ('recorded' as const) : ('none' as const)
    }
  }),
  attention: [],
  attentionTotal: 0,
  warnings: []
}

/**
 * Six top-level workers with no recorded parent and a stale snapshot.
 *
 * This is the shape of the panel report this fixture guards: the run had six
 * workers and only a run-level stale observation, and the panel drew six stacked
 * full-width cards with the stale badge repeated on each of them. The graph now
 * has to join each of the six to the coordinator without inventing a parent, and
 * state the stale observation once.
 */
export const sampleRootsView: RunView = {
  ...sampleView,
  title: '示例：六个顶层 Worker',
  status: 'completed',
  health: 'healthy',
  phase: 'done',
  freshness: 'stale',
  endedAt: observed,
  tasks: [
    task('t-m1-impl', 'M1 实施：票图与面板', 'running'),
    task('t-m1-spec', 'M1 规格：契约与 ADR', 'running'),
    task('t-m2-impl', 'M2 实施：票图与集成 PR', 'reported'),
    task('t-m2-spec', 'M2 规格：流程与权限', 'running'),
    task('t-m2-tickets', 'M2 拆票：拆到可执行票', 'running'),
    task('t-m1-tickets', 'M1 拆票：实现票图', 'running')
  ],
  taskCounts: {
    unknown: 0,
    pending: 0,
    ready: 0,
    running: 5,
    blocked: 0,
    waiting_user: 0,
    reported: 1,
    accepted: 0,
    rejected: 0,
    failed: 0,
    paused: 0,
    cancelled: 0,
    total: 6
  },
  workerTotal: 6,
  workers: [
    worker('w-impl-a1', 't-m1-impl', {
      lifecycle: 'running',
      lastObservedAt: staleObserved,
      freshness: 'stale'
    }),
    worker('w-spec-a1', 't-m1-spec', {
      lifecycle: 'running',
      lastObservedAt: staleObserved,
      freshness: 'stale'
    }),
    worker('w-m2-impl', 't-m2-impl', {
      lifecycle: 'reported_done',
      reportedLifecycle: 'reported_done',
      lastObservedAt: staleObserved,
      freshness: 'stale'
    }),
    worker('w-m2-spec', 't-m2-spec', {
      lifecycle: 'running',
      lastObservedAt: staleObserved,
      freshness: 'stale'
    }),
    worker('w-m2-tickets', 't-m2-tickets', {
      lifecycle: 'running',
      lastObservedAt: staleObserved,
      freshness: 'stale'
    }),
    worker('w-tickets-a1', 't-m1-tickets', {
      lifecycle: 'running',
      lastObservedAt: staleObserved,
      freshness: 'stale'
    })
  ],
  deliveries: [],
  deliveryTotal: 0,
  deliveryCounts: {
    implemented: { yes: 0, no: 0, unverified: 0 },
    integrated: { yes: 0, no: 0, unverified: 0 },
    merged: { yes: 0, no: 0, unverified: 0 },
    tracker_closed: { yes: 0, no: 0, unverified: 0 }
  },
  deliveryMissingTasks: 6,
  artifacts: [],
  artifactTotal: 0,
  events: [],
  eventTotal: 0,
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
