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

function selectionRect(range: Range): DOMRect {
  const rects = range.getClientRects()
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i]
    if (r.width > 0 || r.height > 0) return r
  }
  return range.getBoundingClientRect()
}

export function readTextSelection(
  root: HTMLElement,
): TextSelectionContext | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null

  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null

  const selectedText = sel.toString().replace(/\s+/g, ' ').trim()
  if (selectedText.length < 3) return null

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
    selectedText,
    precedingContext: beforeLines.slice(-20).join('\n'),
    followingContext: afterLines.slice(0, 20).join('\n'),
    rect: selectionRect(range),
  }
}

/**
 * Tracks text selection inside `rootRef` for both mouse and mobile handles.
 * Listens to selectionchange / mouseup / touchend (mouseup alone misses mobile).
 */
export function useTextSelection(
  rootRef: RefObject<HTMLElement | null>,
  opts?: { ignoreSelector?: string },
) {
  const [ctx, setCtx] = useState<TextSelectionContext | null>(null)
  const ignoreSelector = opts?.ignoreSelector ?? '[data-selection-toolbar]'
  const timerRef = useRef(0)

  const sync = useCallback(() => {
    const root = rootRef.current
    if (!root) {
      setCtx(null)
      return
    }
    setCtx(readTextSelection(root))
  }, [rootRef])

  const scheduleSync = useCallback(
    (delayMs: number) => {
      window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(sync, delayMs)
    },
    [sync],
  )

  const clear = useCallback(() => {
    window.clearTimeout(timerRef.current)
    setCtx(null)
  }, [])

  useEffect(() => {
    const onSelectionChange = () => scheduleSync(80)

    const onPointerUp = (e: Event) => {
      const target = e.target
      if (
        target instanceof Element &&
        target.closest(ignoreSelector)
      ) {
        return
      }
      // Mobile selection handles finalize after touchend.
      const delay = e.type === 'touchend' ? 280 : 40
      scheduleSync(delay)
    }

    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('mouseup', onPointerUp)
    document.addEventListener('touchend', onPointerUp, { passive: true })

    return () => {
      window.clearTimeout(timerRef.current)
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('mouseup', onPointerUp)
      document.removeEventListener('touchend', onPointerUp)
    }
  }, [ignoreSelector, scheduleSync])

  useEffect(() => {
    const onScroll = () => {
      // Keep mobile bottom bar; only clear absolute positioning consumers on scroll
      // by re-reading (rect changes). Callers that need dismiss can clear themselves.
      scheduleSync(60)
    }
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [scheduleSync])

  return { ctx, clear, sync }
}

/** Keep selection alive when pressing toolbar buttons (esp. iOS). */
export function preserveSelectionOnPointerDown(
  e: PointerEvent | MouseEvent,
) {
  e.preventDefault()
}
