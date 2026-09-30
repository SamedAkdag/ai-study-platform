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
 * Tracks text selection inside `rootRef` for mouse + mobile handles.
 *
 * Keeps the last valid selection pinned until an outside tap or clear(),
 * so collapsing the native selection when pressing the action bar does not
 * unmount the buttons before the action runs.
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
    window.clearTimeout(timerRef.current)
    pinnedRef.current = null
    setCtx(null)
  }, [])

  /** Snapshot for actions — survives collapse after toolbar press. */
  const snapshot = useCallback((): TextSelectionContext | null => {
    return pinnedRef.current
  }, [])

  useEffect(() => {
    const onSelectionChange = () => {
      if (holdingRef.current) return
      window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        const root = rootRef.current
        if (!root) return
        const next = readTextSelection(root)
        // Only upgrade / refresh — never auto-dismiss on collapse (mobile tap).
        if (next) applyCtx(next)
      }, 80)
    }

    const onOutsidePointerUp = (e: Event) => {
      const target = e.target
      if (target instanceof Element && target.closest(ignoreSelector)) {
        return
      }
      holdingRef.current = false
      const delay = e.type === 'touchend' ? 220 : 30
      window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        const root = rootRef.current
        const next = root ? readTextSelection(root) : null
        applyCtx(next)
      }, delay)
    }

    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('mouseup', onOutsidePointerUp)
    document.addEventListener('touchend', onOutsidePointerUp, {
      passive: true,
    })

    return () => {
      window.clearTimeout(timerRef.current)
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('mouseup', onOutsidePointerUp)
      document.removeEventListener('touchend', onOutsidePointerUp)
    }
  }, [applyCtx, ignoreSelector, rootRef])

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
