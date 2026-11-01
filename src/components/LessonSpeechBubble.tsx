import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactFlowInstance } from '@xyflow/react'

type Props = {
  rf: ReactFlowInstance | null
  canvasEl: HTMLElement | null
  nodeId: string | null
  title: string
  words: string[]
  highlight: number
  /** Recompute when viewport animates */
  viewportEpoch: number
  visible: boolean
}

/**
 * Floating caption beside the spoken mind-map node (screen-space overlay).
 * Long narrations auto-scroll so the spoken word stays in view.
 */
export default function LessonSpeechBubble({
  rf,
  canvasEl,
  nodeId,
  title,
  words,
  highlight,
  viewportEpoch,
  visible,
}: Props) {
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  const textRef = useRef<HTMLParagraphElement | null>(null)
  const activeWordRef = useRef<HTMLSpanElement | null>(null)
  const lastScrollSegRef = useRef<string>('')
  const [style, setStyle] = useState<{
    left: number
    top: number
    place: 'right' | 'left' | 'below'
  } | null>(null)
  const [canScroll, setCanScroll] = useState(false)

  useLayoutEffect(() => {
    if (!visible || !rf || !canvasEl || !nodeId) return
    const node = rf.getNode(nodeId)
    if (!node) return

    const w = node.measured?.width ?? 168
    const h = node.measured?.height ?? 48
    const canvasRect = canvasEl.getBoundingClientRect()
    const bw = Math.min(300, Math.max(200, bubbleRef.current?.offsetWidth || 280))
    const bh = Math.max(96, bubbleRef.current?.offsetHeight || 120)

    const rightAnchor = rf.flowToScreenPosition({
      x: node.position.x + w + 16,
      y: node.position.y + h * 0.35,
    })
    const leftAnchor = rf.flowToScreenPosition({
      x: node.position.x - 16,
      y: node.position.y + h * 0.35,
    })
    const belowAnchor = rf.flowToScreenPosition({
      x: node.position.x + w * 0.5,
      y: node.position.y + h + 14,
    })

    const pad = 12
    let place: 'right' | 'left' | 'below' = 'right'
    let left = rightAnchor.x - canvasRect.left
    let top = rightAnchor.y - canvasRect.top

    const roomRight = canvasRect.width - left
    const roomLeft = leftAnchor.x - canvasRect.left
    if (roomRight < bw + pad && roomLeft > bw + pad) {
      place = 'left'
      left = leftAnchor.x - canvasRect.left - bw
      top = leftAnchor.y - canvasRect.top
    } else if (roomRight < bw + pad) {
      place = 'below'
      left = belowAnchor.x - canvasRect.left - bw / 2
      top = belowAnchor.y - canvasRect.top
    }

    left = Math.max(pad, Math.min(left, canvasRect.width - bw - pad))
    top = Math.max(pad, Math.min(top, canvasRect.height - bh - pad))

    setStyle((prev) => {
      if (
        prev &&
        prev.place === place &&
        Math.abs(prev.left - left) < 1 &&
        Math.abs(prev.top - top) < 1
      ) {
        return prev
      }
      return { left, top, place }
    })
  }, [visible, rf, canvasEl, nodeId, viewportEpoch, words.length, title])

  // New segment → jump to top once
  useLayoutEffect(() => {
    const key = `${nodeId}::${title}::${words.length}`
    if (key === lastScrollSegRef.current) return
    lastScrollSegRef.current = key
    const el = textRef.current
    if (!el) return
    el.scrollTop = 0
    const overflow = el.scrollHeight > el.clientHeight + 2
    setCanScroll((prev) => (prev === overflow ? prev : overflow))
  }, [nodeId, title, words.length])

  // Nudge scroll only when the active word leaves the comfort band (no smooth — avoids jitter)
  useLayoutEffect(() => {
    const box = textRef.current
    const word = activeWordRef.current
    if (!box || !word || highlight < 0) return

    const overflow = box.scrollHeight > box.clientHeight + 2
    setCanScroll((prev) => (prev === overflow ? prev : overflow))
    if (!overflow) return

    const padTop = box.clientHeight * 0.2
    const padBottom = box.clientHeight * 0.28
    const wordTop = word.offsetTop
    const wordBottom = wordTop + word.offsetHeight
    const viewTop = box.scrollTop
    const viewBottom = viewTop + box.clientHeight

    let next = viewTop
    if (wordBottom > viewBottom - padBottom) {
      next = wordBottom - box.clientHeight + padBottom
    } else if (wordTop < viewTop + padTop) {
      next = wordTop - padTop
    } else {
      return
    }

    next = Math.max(0, Math.min(next, box.scrollHeight - box.clientHeight))
    if (Math.abs(next - viewTop) < 4) return
    // Instant set — smooth restarts every tick and shakes the whole caption
    box.scrollTop = next
  }, [highlight])

  if (!visible || !nodeId) return null

  return (
    <div
      ref={bubbleRef}
      className={`lesson-bubble lesson-bubble--${style?.place || 'right'}${
        style ? ' lesson-bubble--ready' : ' lesson-bubble--pending'
      }${canScroll ? ' lesson-bubble--scrollable' : ''}`}
      style={
        style
          ? { left: style.left, top: style.top }
          : { left: 16, top: 16 }
      }
      role="status"
      aria-live="polite"
    >
      <div className="lesson-bubble__tail" aria-hidden />
      <p className="lesson-bubble__kicker">Anlatım</p>
      <h4 className="lesson-bubble__title">{title}</h4>
      <div className="lesson-bubble__text-wrap">
        <p className="lesson-bubble__text" ref={textRef}>
          {words.map((w, i) => (
            <span
              key={`${i}-${w}`}
              ref={i === highlight ? activeWordRef : undefined}
              className={
                i === highlight
                  ? 'lesson-bubble__kw lesson-bubble__kw--on'
                  : i < highlight
                    ? 'lesson-bubble__kw lesson-bubble__kw--past'
                    : 'lesson-bubble__kw'
              }
            >
              {w}{' '}
            </span>
          ))}
        </p>
      </div>
    </div>
  )
}
