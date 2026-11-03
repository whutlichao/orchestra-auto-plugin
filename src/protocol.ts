// The panel <-> worker contract, declared once. Both sides import it through
// the TypeScript project include; it has no runtime behaviour.
import type { RunListing, RunView } from './contract'

export {}

declare module 'orca' {
  interface PluginRequests {
    /** List the runs reachable through the configured audit roots. */
    'runs.list': { output: RunListing }
    /** Read one run's projected snapshot; `runId` is a registry/audit ID, never a path. */
    'run.get': { input: { runId: string }; output: RunView }
  }
}
