// The plugin's worker. It reads only settings and the local progress registry /
// audit roots; it never writes run state, calls Orca orchestration, or opens a
// terminal. All request handling is read-only.
import type { OrcaWorkerApi } from 'orca/worker'
import { isRecord } from './contract'
import { discoverRuns, lookupRun, type DiscoverySettings } from './discovery'

class RequestError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'RequestError'
    this.code = code
  }
}

async function readSettings(orca: OrcaWorkerApi): Promise<DiscoverySettings> {
  const settings = await orca.settings.get()
  return {
    auditRoots: settings.auditRoots,
    registryHome: settings.registryHome
  }
}

export default function activate(orca: OrcaWorkerApi): void {
  orca.panels.handle('runs.list', async () => {
    try {
      return discoverRuns(await readSettings(orca)).listing
    } catch {
      throw new RequestError('read_failed', '读取运行列表失败')
    }
  })

  orca.panels.handle('run.get', async (input) => {
    const value: unknown = input
    if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value.runId !== 'string') {
      throw new RequestError('invalid_params', 'run.get 只接受 { runId }')
    }
    try {
      const result = discoverRuns(await readSettings(orca))
      const lookup = lookupRun(result, value.runId)
      if (!lookup.ok) throw new RequestError(lookup.code, lookup.message)
      return lookup.view
    } catch (error) {
      if (error instanceof RequestError) throw error
      throw new RequestError('read_failed', '读取运行快照失败')
    }
  })
}
