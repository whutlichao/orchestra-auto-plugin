// Panel state and request lifecycle: the run listing, the selected run's
// detail, and the one in-flight generation that owns each response.
//
// The panel imports these atoms and actions; it renders them and never talks to
// the worker itself. Read-only: every request is a `runs.list` or `run.get`.
import { atom, plugin, read, set, settings, type PanelContext } from 'orca'
import type { RunListing, RunView } from './contract'

export type PanelError = { code: string; message: string }

const ERROR_TEXT: Record<string, string> = {
  invalid_params: '请求参数无效',
  invalid_run_id: '运行 ID 无效',
  run_not_found: '这个运行已不存在',
  run_unavailable: '该运行不可用',
  run_corrupt: '该运行的 progress.json 损坏或不受支持',
  read_failed: '读取运行数据失败',
  timeout: '读取超时',
  unavailable: 'worker 尚未启动或不可用',
  unknown_method: 'worker 不支持该请求',
  capability_denied: '缺少读取设置的权限',
  consent_required: '插件尚未获得授权',
  not_permitted: '当前上下文不允许读取',
  action_failed: '读取失败'
}

export const listing = atom<RunListing | null>(null)
export const listingError = atom<PanelError | null>(null)
export const detail = atom<RunView | null>(null)
export const detailError = atom<PanelError | null>(null)
export const loading = atom(false)
export const detailLoading = atom(false)
export const selectedRunId = atom('selectedRunId', '', { persist: 'plugin' })
export const selectedTab = atom('selectedTab', 'topology', { persist: 'plugin' })
export const selectedWorkerId = atom('selectedWorkerId', '', { persist: 'plugin' })

let generation = 0

function panelError(error: unknown): PanelError {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string') {
      if (code === 'run_unavailable' || code === 'run_corrupt') {
        const message = (error as { message?: unknown }).message
        if (typeof message === 'string' && message.length > 0 && message.length <= 200) {
          return { code, message }
        }
      }
      return { code, message: ERROR_TEXT[code] ?? ERROR_TEXT.action_failed }
    }
  }
  return { code: 'action_failed', message: ERROR_TEXT.action_failed }
}

async function loadRun(runId: string, current: number): Promise<void> {
  set(detailLoading, true)
  set(detailError, null)
  try {
    const view = await plugin.request('run.get', { runId })
    if (current !== generation) return
    set(detail, view)
  } catch (error) {
    if (current !== generation) return
    set(detail, null)
    set(detailError, panelError(error))
  } finally {
    if (current === generation) set(detailLoading, false)
  }
}

/** Reload the listing, then the selected (or first) run. */
export async function refresh(): Promise<void> {
  const current = ++generation
  set(loading, true)
  set(detailLoading, false)
  set(listingError, null)
  try {
    const next = await plugin.request('runs.list')
    if (current !== generation) return
    set(listing, next)
    const wanted = read(selectedRunId)
    const selected = next.runs.find((run) => run.id === wanted) ?? next.runs[0]
    if (!selected) {
      set(selectedRunId, '')
      set(selectedWorkerId, '')
      set(detail, null)
      set(detailError, null)
      return
    }
    if (selected.id !== read(selectedRunId)) {
      set(selectedWorkerId, '')
      set(detail, null)
      set(detailError, null)
    }
    set(selectedRunId, selected.id)
    await loadRun(selected.id, current)
  } catch (error) {
    if (current !== generation) return
    set(listingError, panelError(error))
    set(detailLoading, false)
  } finally {
    if (current === generation) {
      set(loading, false)
      set(detailLoading, false)
    }
  }
}

/** Show one run; its earlier detail is dropped until the answer arrives. */
export function selectRun(runId: string): void {
  const current = ++generation
  set(loading, false)
  set(selectedRunId, runId)
  set(selectedWorkerId, '')
  set(detail, null)
  set(detailError, null)
  void loadRun(runId, current)
}

/** Runs once before the first render; requests end with the panel. */
export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(
    settings.onDidChange(() => {
      void refresh()
    })
  )
  void refresh()
}
