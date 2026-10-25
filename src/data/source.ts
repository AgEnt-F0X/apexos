/* ============================================================
   SessionSource — the seam that keeps the app live-ready.
   Everything downstream consumes SessionData + a clock; it never
   knows whether bytes came from a static hero pack, IndexedDB,
   the API via the worker, or (later) a live feed appending rows.
   ============================================================ */

import { decodePack } from './pack'
import type { LoadProgress, SessionData, WorkerResponse } from './types'

export interface SessionSource {
  load(sessionKey: number, onProgress: (p: LoadProgress) => void): Promise<SessionData>
}

/** Historical sessions: static pack → worker (cache → API). */
export class ReplaySource implements SessionSource {
  async load(sessionKey: number, onProgress: (p: LoadProgress) => void): Promise<SessionData> {
    // 1. pre-warmed hero pack on the CDN (same artifact the worker would build)
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}packs/${sessionKey}.apx`)
      if (res.ok) {
        onProgress({ stage: 'cache', frac: 0.5, label: 'HERO PACK — DIRECT INJECT', rows: 0 })
        const buffer = await res.arrayBuffer()
        return decodePack(buffer)
      }
    } catch {
      // no hero pack — normal path
    }

    // 2. worker pipeline (its own IndexedDB check, then the API)
    return new Promise<SessionData>((resolve, reject) => {
      const worker = new Worker(new URL('./sessionWorker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const msg = ev.data
        if (msg.type === 'progress') {
          onProgress(msg.progress)
        } else if (msg.type === 'done') {
          worker.terminate()
          try {
            resolve(decodePack(msg.buffer))
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)))
          }
        } else {
          worker.terminate()
          reject(new Error(msg.message))
        }
      }
      worker.onerror = (ev) => {
        worker.terminate()
        reject(new Error(ev.message || 'session worker crashed'))
      }
      worker.postMessage({ type: 'load', sessionKey })
    })
  }
}

export const replaySource = new ReplaySource()
