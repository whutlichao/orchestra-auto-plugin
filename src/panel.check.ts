// `orca plugin check` renders the panel once per scenario against a stand-in
// host. Each scenario stubs the worker's two read requests so check never
// touches a real audit directory.
import { defineCheck, hostError } from 'orca/testing'
import {
  corruptSummary,
  emptyListing,
  finishedSummary,
  sampleListing,
  sampleSecondView,
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
      'run.get': () => sampleSecondView
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
