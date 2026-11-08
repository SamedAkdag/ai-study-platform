/**
 * IndexedDB cache for lesson EMA WAV segments + word timings.
 */

import type { EmaTimingTrack } from '@/lib/emaTimings'

const DB_NAME = 'studium-lesson-wav-v1'
const STORE = 'segments'
const DB_VERSION = 1

type CachedSeg = {
  blob: Blob
  timings: EmaTimingTrack
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error || new Error('IDB open failed'))
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
  })
}

export function hashLessonScriptKey(
  chapterId: string,
  stepTexts: string[],
  speed: number,
): string {
  const raw = `${chapterId}|${speed}|${stepTexts.join('\u0001')}`
  let h = 2166136261
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `ls:${(h >>> 0).toString(36)}`
}

function isTimingTrack(v: unknown): v is EmaTimingTrack {
  if (!v || typeof v !== 'object') return false
  const t = v as EmaTimingTrack
  return (
    typeof t.duration === 'number' &&
    Array.isArray(t.words) &&
    t.words.length > 0
  )
}

export async function getCachedSegment(
  cacheKey: string,
  stepId: string,
): Promise<CachedSeg | null> {
  try {
    const db = await openDb()
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(`${cacheKey}::${stepId}`)
      req.onsuccess = () => {
        const v = req.result as CachedSeg | undefined
        if (
          v &&
          v.blob instanceof Blob &&
          isTimingTrack(v.timings)
        ) {
          resolve(v)
        } else {
          resolve(null)
        }
      }
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function putCachedSegment(
  cacheKey: string,
  stepId: string,
  blob: Blob,
  timings: EmaTimingTrack,
): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      const payload: CachedSeg = { blob, timings }
      tx.objectStore(STORE).put(payload, `${cacheKey}::${stepId}`)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    /* ignore quota */
  }
}
