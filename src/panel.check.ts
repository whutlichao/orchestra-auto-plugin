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
    persisted: { plugin: { selectedRunId: 'demo-active', selectedWorkerId: 'w-plan-a1' } },
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
    persisted: { plugin: { selectedRunId: 'demo-active', selectedTab: 'details' } },
    requests: {
      'runs.list': () => sampleListing,
      'run.get': () => sampleView
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
