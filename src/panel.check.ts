// `orca plugin check` renders the panel once per scenario against a stand-in
// host. Each scenario stubs the worker's two read requests so check never
// touches a real audit directory.
import { defineCheck, hostError } from 'orca/testing'
import {
  corruptSummary,
  emptyListing,
  finishedSummary,
  sampleListing,
  sampleFinishedView,
  sampleView,
  unconfiguredListing,
  unavailableSummary
} from './sample-data'

// One worker and one attention item: the on-demand sections still fit a single
// window-height screenshot, which a long graph would push below the fold.
const smallView = {
  ...sampleView,
  workerTotal: 1,
  workers: [sampleView.workers[0]],
  tasks: [sampleView.tasks[0], sampleView.tasks[2]],
  taskCounts: { ...sampleView.taskCounts, total: 2 },
  deliveries: [],
  deliveryTotal: 0,
  artifacts: [],
  artifactTotal: 0,
  events: [],
  eventTotal: 0,
  attentionTotal: 1,
  attention: sampleView.attention.slice(0, 1),
  warnings: []
}

export default defineCheck({
  unconfigured: {
    requests: {
      'runs.list': () => unconfiguredListing
    }
  },
  empty: {
    requests: {
      'runs.list': () => emptyListing
    }
  },
  ready: {
    requests: {
      'runs.list': () => sampleListing,
      'run.get': () => sampleView
    }
  },
  finished: {
    requests: {
      'runs.list': () => ({ ...sampleListing, runs: [finishedSummary], warnings: [] }),
      'run.get': () => sampleFinishedView
    }
  },
  worker: {
    persisted: { plugin: { selectedRunId: 'demo-active', selectedWorkerId: 'w-panel-a1' } },
    requests: {
      'runs.list': () => sampleListing,
      'run.get': () => sampleView
    }
  },
  anomaly: {
    persisted: { plugin: { selectedRunId: 'demo-active', selectedWorkerId: 'w-api-a1' } },
    requests: {
      'runs.list': () => sampleListing,
      'run.get': () => sampleView
    }
  },
  details: {
    persisted: { plugin: { selectedRunId: 'demo-active', detailsOpen: true } },
    requests: {
      'runs.list': () => sampleListing,
      'run.get': () => smallView
    }
  },
  cycle: {
    requests: {
      'runs.list': () => sampleListing,
      'run.get': () => ({
        ...sampleView,
        workerTotal: 2,
        attention: [],
        attentionTotal: 0,
        workers: [
          {
            ...sampleView.workers[1],
            id: 'w-cycle-a',
            parentWorkerId: 'w-cycle-b',
            parentState: 'recorded' as const
          },
          {
            ...sampleView.workers[1],
            id: 'w-cycle-b',
            parentWorkerId: 'w-cycle-a',
            parentState: 'recorded' as const
          }
        ]
      })
    }
  },
  attention: {
    persisted: { plugin: { selectedRunId: 'demo-active', attentionOpen: true } },
    requests: {
      'runs.list': () => sampleListing,
      'run.get': () => smallView
    }
  },
  branches: {
    requests: {
      'runs.list': () => sampleListing,
      'run.get': () => {
        const base = sampleView.workers[0]
        const worker = (
          id: string,
          taskId: string,
          parentId: string | null,
          extra: Partial<typeof base> = {}
        ) => ({
          ...base,
          id,
          taskId,
          parentWorkerId: parentId,
          parentState: parentId === null ? ('none' as const) : ('recorded' as const),
          ...extra
        })
        return {
          ...sampleView,
          workerTotal: 8,
          attention: [],
          attentionTotal: 0,
          workers: [
            worker('w-coord-plan', 't-plan', null),
            worker('w-coord-panel', 't-panel', null),
            worker('w-coord-docs', 't-docs', null),
            worker('w-plan-child-a', 't-extra', 'w-coord-plan'),
            worker('w-plan-child-b', 't-api', 'w-coord-plan', { lifecycle: 'waiting_user' as const }),
            worker('w-panel-child', 't-panel', 'w-coord-panel'),
            worker('w-panel-grandchild', 't-docs', 'w-panel-child', { lifecycle: 'reported_done' as const }),
            worker('w-docs-child', 't-old', 'w-coord-docs', { lifecycle: 'closed' as const })
          ]
        }
      }
    }
  },
  deep: {
    requests: {
      'runs.list': () => sampleListing,
      'run.get': () => {
        const base = sampleView.workers[0]
        const depth = 15
        return {
          ...sampleView,
          workerTotal: depth,
          attention: [],
          attentionTotal: 0,
          workers: Array.from({ length: depth }, (_, index) => ({
            ...base,
            id: 'w-deep-' + index,
            taskId: 't-plan',
            parentWorkerId: index === 0 ? null : 'w-deep-' + (index - 1),
            parentState: index === 0 ? ('none' as const) : ('recorded' as const)
          }))
        }
      }
    }
  },
  'long-text': {
    persisted: {
      plugin: {
        selectedRunId: 'demo-active',
        selectedWorkerId: 'w-long-worker-identifier-that-does-not-fit-a-narrow-sidebar-card'
      }
    },
    requests: {
      'runs.list': () => sampleListing,
      'run.get': () => {
        const base = sampleView.workers[0]
        const longTask =
          '一个非常长的任务标题，用来确认窄侧栏里的节点卡片会截断而不是把面板撑破，同时详情里仍然能看到完整文字'
        return {
          ...sampleView,
          workerTotal: 2,
          attention: [],
          attentionTotal: 0,
          tasks: [
            ...sampleView.tasks,
            {
              id: 't-long',
              title: longTask,
              status: 'running' as const,
              dependencies: ['t-plan'],
              blockedReason: '',
              pendingDecision: '',
              provisional: false,
              orcaTaskId: null
            }
          ],
          workers: [
            {
              ...base,
              id: 'w-long-worker-identifier-that-does-not-fit-a-narrow-sidebar-card',
              taskId: 't-long',
              parentWorkerId: null,
              parentState: 'none' as const
            },
            {
              ...base,
              id: 'w-long-child-identifier-also-quite-long-for-the-narrow-card',
              taskId: 't-long',
              parentWorkerId: 'w-long-worker-identifier-that-does-not-fit-a-narrow-sidebar-card',
              parentState: 'recorded' as const
            }
          ]
        }
      }
    }
  },
  'no-workers': {
    requests: {
      'runs.list': () => sampleListing,
      'run.get': () => ({ ...sampleView, workerTotal: 0, workers: [], attention: [], attentionTotal: 0 })
    }
  },
  'large-workers': {
    requests: {
      'runs.list': () => sampleListing,
      'run.get': () => ({
        ...sampleView,
        workerTotal: 120,
        workers: Array.from({ length: 120 }, (_, index) => ({
          ...sampleView.workers[0],
          id: 'w-bulk-' + index,
          taskId: 't-plan',
          parentWorkerId: null,
          parentState: 'none' as const,
          attempt: 1
        })),
        attention: [],
        attentionTotal: 0
      })
    }
  },
  stale: {
    requests: {
      'runs.list': () => sampleListing,
      'run.get': () => ({ ...sampleView, freshness: 'stale' as const })
    }
  },
  unavailable: {
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
  },
  corrupt: {
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
  }
})
