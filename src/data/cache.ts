/* ============================================================
   IndexedDB pack cache — works on main thread and in workers.
   ============================================================ */

import { openDB, type IDBPDatabase } from 'idb'
import { PACK_VERSION } from './pack'

interface PackRecord {
  sessionKey: number
  version: number
  savedAt: number
  bytes: number
  buffer: ArrayBuffer
}

const DB_NAME = 'apexos'
const STORE = 'packs'

let dbPromise: Promise<IDBPDatabase> | null = null

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(d) {
        d.createObjectStore(STORE, { keyPath: 'sessionKey' })
      },
    })
  }
  return dbPromise
}

export async function getCachedPack(sessionKey: number): Promise<ArrayBuffer | null> {
  try {
    const rec = (await (await db()).get(STORE, sessionKey)) as PackRecord | undefined
    if (!rec || rec.version !== PACK_VERSION) return null
    return rec.buffer
  } catch {
    return null
  }
}

export async function putCachedPack(sessionKey: number, buffer: ArrayBuffer): Promise<void> {
  try {
    const rec: PackRecord = {
      sessionKey,
      version: PACK_VERSION,
      savedAt: Date.now(),
      bytes: buffer.byteLength,
      buffer,
    }
    await (await db()).put(STORE, rec)
  } catch {
    // cache is best-effort; never fail a load because of it
  }
}

export async function listCachedSessions(): Promise<Array<{ sessionKey: number; bytes: number; savedAt: number }>> {
  try {
    const all = (await (await db()).getAll(STORE)) as PackRecord[]
    return all
      .filter((r) => r.version === PACK_VERSION)
      .map((r) => ({ sessionKey: r.sessionKey, bytes: r.bytes, savedAt: r.savedAt }))
  } catch {
    return []
  }
}

export async function deleteCachedPack(sessionKey: number): Promise<void> {
  try {
    await (await db()).delete(STORE, sessionKey)
  } catch {
    // ignore
  }
}
