import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'
import type { PdfWordGroup } from '@/lib/pdfWordEdit'
import {
  bandsClientRect,
  findWordIndexAt,
  lineRangeContaining,
  selectionFromIndices,
  sortWordsReadingOrder,
  type PdfWordSelResult,
} from '@/lib/pdfLineSelect'
import type { TextSelectionContext } from '@/hooks/useTextSelection'

type Opts = {
  enabled: boolean
  /** Ignore presses on toolbar etc. */
  ignoreSelector?: string
  /** When true, don't start a new selection (area mode / word edit). */
  blocked?: boolean
}

/**
 * Professional PDF text selection on word geometry (not native DOM Selection).
 * - Drag: contiguous word range with live line-band highlights
 * - Double-click: word
 * - Triple-click: full line
 * - Shift+click: extend from anchor
 */
export function usePdfWordSelection(
  hostRef: RefObject<HTMLElement | null>,
  wordGroups: PdfWordGroup[],
  opts: Opts,
) {
  const [result, setResult] = useState<PdfWordSelResult | null>(null)
  const [liveBands, setLiveBands] = useState(result?.bands ?? null)
  const sortedRef = useRef<PdfWordGroup[]>([])
  const anchorRef = useRef<number>(-1)
  const draggingRef = useRef(false)
  const holdingRef = useRef(false)
  const pointerIdRef = useRef<number | null>(null)
  const clickRef = useRef<{ t: number; i: number; count: number }>({
    t: 0,
    i: -1,
    count: 0,
  })
  const pinnedRef = useRef<PdfWordSelResult | null>(null)
  const enabled = opts.enabled
  const blocked = !!opts.blocked
  const ignoreSelector = opts.ignoreSelector ?? '[data-selection-toolbar]'

  useEffect(() => {
    sortedRef.current = sortWordsReadingOrder(wordGroups)
  }, [wordGroups])

  useEffect(() => {
    if (!enabled) {
      pinnedRef.current = null
      setResult(null)
      setLiveBands(null)
    }
  }, [enabled])

  const apply = useCallback((next: PdfWordSelResult | null) => {
    pinnedRef.current = next
    setResult(next)
    setLiveBands(next?.bands ?? null)
  }, [])

  const clear = useCallback(() => {
    holdingRef.current = false
    draggingRef.current = false
    pointerIdRef.current = null
    anchorRef.current = -1
    apply(null)
  }, [apply])

  const hold = useCallback(() => {
    holdingRef.current = true
  }, [])

  const snapshot = useCallback((): TextSelectionContext | null => {
    const p = pinnedRef.current
    if (!p) return null
    const host = hostRef.current
    if (!host) return null
    const rect = bandsClientRect(p.bands, host.getBoundingClientRect())
    return {
      selectedText: p.text,
      precedingContext: p.precedingContext,
      followingContext: p.followingContext,
      rect,
      textStyle: p.textStyle,
    }
  }, [hostRef])

  const setRange = useCallback(
    (start: number, end: number, pinAnchor?: number) => {
      const sel = selectionFromIndices(sortedRef.current, start, end)
      if (pinAnchor != null) anchorRef.current = pinAnchor
      apply(sel)
    },
    [apply],
  )

  useEffect(() => {
    if (!enabled) return
    const host = hostRef.current
    if (!host) return

    const localXY = (e: PointerEvent) => {
      const box = host.getBoundingClientRect()
      return { x: e.clientX - box.left, y: e.clientY - box.top }
    }

    const onDown = (e: PointerEvent) => {
      if (blocked) return
      const t = e.target
      if (t instanceof Element && t.closest(ignoreSelector)) {
        // Insert HTML uses native select — drop PDF word pin so it can win
        if (t.closest('[data-insert-slot], .pdf-insert')) {
          apply(null)
        } else {
          holdingRef.current = true
        }
        return
      }
      if (e.button !== 0) return

      const { x, y } = localXY(e)
      const idx = findWordIndexAt(sortedRef.current, x, y)
      if (idx < 0) {
        // Click on empty paper — drop selection
        if (!holdingRef.current) clear()
        return
      }

      // Don't steal double-click for word editor — still allow select range
      const now = Date.now()
      const prev = clickRef.current
      const same =
        prev.i === idx && now - prev.t < 420
      const count = same ? prev.count + 1 : 1
      clickRef.current = { t: now, i: idx, count }

      if (e.shiftKey && anchorRef.current >= 0) {
        e.preventDefault()
        setRange(anchorRef.current, idx)
        draggingRef.current = false
        return
      }

      // Triple-click → select whole line (edit stays on double-click via PdfViewer)
      if (count >= 3) {
        e.preventDefault()
        const line = lineRangeContaining(sortedRef.current, idx)
        setRange(line.start, line.end, idx)
        clickRef.current.count = 0
        draggingRef.current = false
        return
      }

      // Second click of a double-click: don't capture — let onDoubleClick open editor
      if (count === 2) {
        draggingRef.current = false
        pointerIdRef.current = null
        return
      }

      // Start drag selection
      e.preventDefault()
      draggingRef.current = true
      pointerIdRef.current = e.pointerId
      anchorRef.current = idx
      setRange(idx, idx, idx)
      try {
        host.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    }

    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current || pointerIdRef.current !== e.pointerId) return
      const { x, y } = localXY(e)
      const idx = findWordIndexAt(sortedRef.current, x, y, { nearest: true })
      if (idx < 0 || anchorRef.current < 0) return
      const sel = selectionFromIndices(
        sortedRef.current,
        anchorRef.current,
        idx,
      )
      if (sel) {
        pinnedRef.current = sel
        setResult(sel)
        setLiveBands(sel.bands)
      }
    }

    const onUp = (e: PointerEvent) => {
      if (pointerIdRef.current != null && e.pointerId !== pointerIdRef.current) {
        return
      }
      if (draggingRef.current) {
        draggingRef.current = false
        try {
          host.releasePointerCapture(e.pointerId)
        } catch {
          /* ignore */
        }
      }
      pointerIdRef.current = null
      holdingRef.current = false
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clear()
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        if (blocked) return
        const n = sortedRef.current.length
        if (!n) return
        e.preventDefault()
        setRange(0, n - 1, 0)
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        const p = pinnedRef.current
        if (!p?.text) return
        void navigator.clipboard?.writeText(p.text)
      }
    }

    const onWinUp = () => {
      // Toolbar / ignore targets may swallow host pointerup — never leave hold stuck
      holdingRef.current = false
      if (draggingRef.current) {
        draggingRef.current = false
        pointerIdRef.current = null
      }
    }

    host.addEventListener('pointerdown', onDown)
    host.addEventListener('pointermove', onMove)
    host.addEventListener('pointerup', onUp)
    host.addEventListener('pointercancel', onUp)
    window.addEventListener('pointerup', onWinUp)
    window.addEventListener('pointercancel', onWinUp)
    window.addEventListener('keydown', onKey)

    return () => {
      host.removeEventListener('pointerdown', onDown)
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerup', onUp)
      host.removeEventListener('pointercancel', onUp)
      window.removeEventListener('pointerup', onWinUp)
      window.removeEventListener('pointercancel', onWinUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [
    apply,
    enabled,
    blocked,
    clear,
    hostRef,
    ignoreSelector,
    setRange,
  ])

  const ctx: TextSelectionContext | null = (() => {
    if (!result || !hostRef.current) return null
    const rect = bandsClientRect(
      result.bands,
      hostRef.current.getBoundingClientRect(),
    )
    return {
      selectedText: result.text,
      precedingContext: result.precedingContext,
      followingContext: result.followingContext,
      rect,
      textStyle: result.textStyle,
    }
  })()

  return {
    ctx,
    bands: liveBands ?? result?.bands ?? null,
    result,
    clear,
    hold,
    snapshot,
  }
}
