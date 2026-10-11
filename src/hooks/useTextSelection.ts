import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react'

export type TextSelectionContext = {
  selectedText: string
  precedingContext: string
  followingContext: string
  /** Viewport rect of the selection (for absolute toolbars). */
  rect: DOMRect
}

const PDF_SEL_CLASS = 'pdf-sel-hit'

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function selectionRect(range: Range): DOMRect {
  const rects = range.getClientRects()
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i]
    if (r.width > 0 || r.height > 0) return r
  }
  return range.getBoundingClientRect()
}

function rectsOverlap(
  a: DOMRectReadOnly,
  b: DOMRectReadOnly,
  slop = 2,
): boolean {
  return (
    a.left <= b.right + slop &&
    a.right >= b.left - slop &&
    a.top <= b.bottom + slop &&
    a.bottom >= b.top - slop
  )
}

function clearPdfSelMarks(root: HTMLElement) {
  root.querySelectorAll(`.${PDF_SEL_CLASS}`).forEach((el) => {
    el.classList.remove(PDF_SEL_CLASS)
  })
}

function isPdfTextLayerRoot(root: HTMLElement): boolean {
  return !!root.querySelector('.textLayer, .pdf-text-layer')
}

/**
 * pdf.js absolute text-layer spans are often out of visual order in the DOM.
 * Native Selection then highlights / stringifies unrelated spans between the
 * drag start and end. Keep only spans that geometrically intersect the
 * painted selection rects.
 */
function selectedTextGeometric(
  root: HTMLElement,
  range: Range,
): { text: string; rect: DOMRect; spans: HTMLElement[] } | null {
  const selRects = [...range.getClientRects()].filter(
    (r) => r.width > 0.5 && r.height > 0.5,
  )
  if (!selRects.length) {
    const text = normalizeWs(range.toString())
    if (text.length < 3) return null
    return { text, rect: selectionRect(range), spans: [] }
  }

  const layer =
    (root.querySelector('.textLayer, .pdf-text-layer') as HTMLElement | null) ||
    root
  const spans = [...layer.querySelectorAll('span')] as HTMLElement[]
  const hits: { el: HTMLElement; top: number; left: number; text: string }[] =
    []

  for (const span of spans) {
    if (span.classList.contains('is-omitted')) continue
    const sr = span.getBoundingClientRect()
    if (sr.width < 0.5 && sr.height < 0.5) continue
    if (!selRects.some((r) => rectsOverlap(sr, r))) continue

    let text = span.textContent || ''
    const textNode = span.firstChild
    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
      if (
        range.startContainer === textNode &&
        range.endContainer === textNode
      ) {
        text = text.slice(range.startOffset, range.endOffset)
      } else if (range.startContainer === textNode) {
        text = text.slice(range.startOffset)
      } else if (range.endContainer === textNode) {
        text = text.slice(0, range.endOffset)
      }
    }
    if (!text) continue
    hits.push({ el: span, top: sr.top, left: sr.left, text })
  }

  if (!hits.length) {
    const fallback = normalizeWs(range.toString())
    if (fallback.length < 3) return null
    return { text: fallback, rect: selectionRect(range), spans: [] }
  }

  hits.sort((a, b) => a.top - b.top || a.left - b.left)

  let out = ''
  let prev: (typeof hits)[0] | null = null
  for (const h of hits) {
    if (!prev) {
      out = h.text
    } else {
      const prevBox = prev.el.getBoundingClientRect()
      const newLine = h.top - prev.top > Math.max(prevBox.height, 4) * 0.55
      const gap = h.left - (prev.left + prevBox.width)
      if (newLine || (gap > 3 && !/\s$/.test(out) && !/^\s/.test(h.text))) {
        out += ' '
      }
      out += h.text
    }
    prev = h
  }

  const text = normalizeWs(out)
  if (text.length < 3) return null

  const boxes = hits.map((h) => h.el.getBoundingClientRect())
  const minLeft = Math.min(...boxes.map((b) => b.left))
  const minTop = Math.min(...boxes.map((b) => b.top))
  const maxRight = Math.max(...boxes.map((b) => b.right))
  const maxBottom = Math.max(...boxes.map((b) => b.bottom))

  // Viewport rect of the painted selection — toolbar anchors to .bottom
  const rect = new DOMRect(
    minLeft,
    minTop,
    Math.max(1, maxRight - minLeft),
    Math.max(1, maxBottom - minTop),
  )

  return {
    text,
    rect,
    spans: hits.map((h) => h.el),
  }
}

function contextAround(root: HTMLElement, range: Range) {
  const preRange = document.createRange()
  preRange.selectNodeContents(root)
  preRange.setEnd(range.startContainer, range.startOffset)
  const beforeLines = preRange
    .toString()
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const postRange = document.createRange()
  postRange.selectNodeContents(root)
  postRange.setStart(range.endContainer, range.endOffset)
  const afterLines = postRange
    .toString()
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  return {
    precedingContext: beforeLines.slice(-20).join('\n'),
    followingContext: afterLines.slice(0, 20).join('\n'),
  }
}

export function readTextSelection(
  root: HTMLElement,
): TextSelectionContext | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null

  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null

  if (isPdfTextLayerRoot(root)) {
    const geo = selectedTextGeometric(root, range)
    if (!geo) return null
    const ctx = contextAround(root, range)
    return {
      selectedText: geo.text,
      precedingContext: ctx.precedingContext,
      followingContext: ctx.followingContext,
      rect: geo.rect,
    }
  }

  // Prose / markdown: stick to the live Range (not multi-range sel.toString)
  const selectedText = normalizeWs(range.toString())
  if (selectedText.length < 3) return null
  const ctx = contextAround(root, range)
  return {
    selectedText,
    precedingContext: ctx.precedingContext,
    followingContext: ctx.followingContext,
    rect: selectionRect(range),
  }
}

/**
 * Tracks text selection inside `rootRef` for mouse + mobile handles.
 *
 * Keeps the last valid selection pinned until an outside tap or clear(),
 * so collapsing the native selection when pressing the action bar does not
 * unmount the buttons before the action runs.
 *
 * For pdf.js text layers, finalizes with geometric filtering and paints
 * `.pdf-sel-hit` marks so the highlight matches what was actually chosen.
 */
export function useTextSelection(
  rootRef: RefObject<HTMLElement | null>,
  opts?: { ignoreSelector?: string },
) {
  const [ctx, setCtx] = useState<TextSelectionContext | null>(null)
  const ignoreSelector = opts?.ignoreSelector ?? '[data-selection-toolbar]'
  const timerRef = useRef(0)
  const pinnedRef = useRef<TextSelectionContext | null>(null)
  const holdingRef = useRef(false)
  const draggingRef = useRef(false)

  const applyCtx = useCallback((next: TextSelectionContext | null) => {
    pinnedRef.current = next
    setCtx(next)
  }, [])

  const hold = useCallback(() => {
    holdingRef.current = true
    window.clearTimeout(timerRef.current)
  }, [])

  const clear = useCallback(() => {
    holdingRef.current = false
    draggingRef.current = false
    window.clearTimeout(timerRef.current)
    pinnedRef.current = null
    const root = rootRef.current
    if (root) clearPdfSelMarks(root)
    setCtx(null)
  }, [rootRef])

  /** Snapshot for actions — survives collapse after toolbar press. */
  const snapshot = useCallback((): TextSelectionContext | null => {
    return pinnedRef.current
  }, [])

  const finalizeSelection = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      if (!holdingRef.current) {
        clearPdfSelMarks(root)
        applyCtx(null)
      }
      return
    }
    const range = sel.getRangeAt(0)
    if (!root.contains(range.commonAncestorContainer)) {
      if (!holdingRef.current) {
        clearPdfSelMarks(root)
        applyCtx(null)
      }
      return
    }

    if (isPdfTextLayerRoot(root)) {
      const geo = selectedTextGeometric(root, range)
      clearPdfSelMarks(root)
      if (!geo) {
        applyCtx(null)
        return
      }
      geo.spans.forEach((el) => el.classList.add(PDF_SEL_CLASS))
      const around = contextAround(root, range)
      applyCtx({
        selectedText: geo.text,
        precedingContext: around.precedingContext,
        followingContext: around.followingContext,
        rect: geo.rect,
      })
      // Drop native multi-span paint; our marks show the true selection
      sel.removeAllRanges()
      return
    }

    const next = readTextSelection(root)
    applyCtx(next)
  }, [applyCtx, rootRef])

  useEffect(() => {
    const onPointerDown = (e: Event) => {
      const target = e.target
      if (target instanceof Element && target.closest(ignoreSelector)) {
        // Keep pinned selection while pressing toolbar actions
        holdingRef.current = true
        window.clearTimeout(timerRef.current)
        return
      }
      // New drag elsewhere — drop previous pin
      if (pinnedRef.current) {
        const root = rootRef.current
        if (root) clearPdfSelMarks(root)
        applyCtx(null)
      }
      draggingRef.current = true
    }

    const onSelectionChange = () => {
      if (holdingRef.current) return
      // While dragging on a PDF layer, skip intermediate DOM-order noise
      const root = rootRef.current
      if (root && isPdfTextLayerRoot(root) && draggingRef.current) return

      window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        if (holdingRef.current) return
        const el = rootRef.current
        if (!el) return
        if (isPdfTextLayerRoot(el)) return // wait for pointerup
        const next = readTextSelection(el)
        if (next) applyCtx(next)
      }, 80)
    }

    const onOutsidePointerUp = (e: Event) => {
      const target = e.target
      if (target instanceof Element && target.closest(ignoreSelector)) {
        draggingRef.current = false
        return
      }
      holdingRef.current = false
      draggingRef.current = false
      const delay = e.type === 'touchend' ? 220 : 30
      window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        finalizeSelection()
      }, delay)
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('mouseup', onOutsidePointerUp)
    document.addEventListener('touchend', onOutsidePointerUp, {
      passive: true,
    })

    return () => {
      window.clearTimeout(timerRef.current)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('mouseup', onOutsidePointerUp)
      document.removeEventListener('touchend', onOutsidePointerUp)
    }
  }, [applyCtx, finalizeSelection, ignoreSelector, rootRef])

  return { ctx, clear, hold, snapshot }
}

/** Keep selection + toolbar alive when pressing action buttons (esp. iOS). */
export function preserveSelectionOnPointerDown(
  e: PointerEvent | MouseEvent,
  hold?: () => void,
) {
  e.preventDefault()
  hold?.()
}
