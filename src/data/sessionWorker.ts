/* ============================================================
   Dedicated worker entry: owns the fetch/resample/pack pipeline
   so the main thread never drops a frame while a race loads.
   ============================================================ */

import { loadSession } from './sessionLoader'
import type { WorkerRequest, WorkerResponse } from './types'

interface WorkerScope {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null
}

const ctx = self as unknown as WorkerScope

ctx.onmessage = (ev) => {
  const msg = ev.data
  if (msg.type !== 'load') return
  void (async () => {
    try {
      const { buffer, fromCache } = await loadSession(msg.sessionKey, (progress) => {
        ctx.postMessage({ type: 'progress', progress })
      })
      // NOTE: buffer may be the cached copy; transfer is safe — worker dies after.
      ctx.postMessage({ type: 'done', buffer, fromCache }, [buffer])
    } catch (err) {
      ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  })()
}
