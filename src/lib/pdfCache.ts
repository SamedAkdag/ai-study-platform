import type { PageText } from './slidingWindow'

const DB_NAME = 'studium-pdfs'
const STORE_FILES = 'files'
const STORE_PAGES = 'pages'
const DB_VERSION = 2

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES)
      }
      if (!db.objectStoreNames.contains(STORE_PAGES)) {
        db.createObjectStore(STORE_PAGES)
      }
    }
  })
}

/** Cache original PDF bytes locally so the viewer works even if Storage is slow. */
export async function cachePdfLocally(bookId: string, file: Blob): Promise<Blob> {
  const buf = await file.arrayBuffer()
  const blob = new Blob([buf], { type: 'application/pdf' })
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.objectStore(STORE_FILES).put(blob, bookId)
  })
  db.close()
  return blob
}

export async function loadCachedPdf(bookId: string): Promise<Blob | null> {
  const db = await openDb()
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, 'readonly')
    const req = tx.objectStore(STORE_FILES).get(bookId)
    req.onsuccess = () => {
      const v = req.result
      resolve(v instanceof Blob ? v : null)
    }
    req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'))
  })
  db.close()
  return blob
}

/** Store extracted page texts for later optional unit segmentation. */
export async function cachePageTexts(
  bookId: string,
  pages: PageText[],
): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_PAGES, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB pages write failed'))
    tx.objectStore(STORE_PAGES).put(pages, bookId)
  })
  db.close()
}

export async function loadCachedPageTexts(
  bookId: string,
): Promise<PageText[] | null> {
  const db = await openDb()
  const pages = await new Promise<PageText[] | null>((resolve, reject) => {
    const tx = db.transaction(STORE_PAGES, 'readonly')
    const req = tx.objectStore(STORE_PAGES).get(bookId)
    req.onsuccess = () => {
      const v = req.result
      resolve(Array.isArray(v) ? (v as PageText[]) : null)
    }
    req.onerror = () => reject(req.error ?? new Error('IndexedDB pages read failed'))
  })
  db.close()
  return pages
}
