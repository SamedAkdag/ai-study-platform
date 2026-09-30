import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useTts } from '@/hooks/useTts'
import TtsControls from '@/components/TtsControls'

type Props = {
  markdown: string
}

type SelBtn = {
  top: number
  left: number
  selectedText: string
}

/** Read-only markdown with local TTS (shared chapter view). */
export default function MarkdownWithTts({ markdown }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef<HTMLElement>(null)
  const [selBtn, setSelBtn] = useState<SelBtn | null>(null)
  const tts = useTts()

  useEffect(() => () => tts.stop(), [])

  const onMouseUp = useCallback(() => {
    const root = articleRef.current
    const wrap = wrapRef.current
    if (!root || !wrap) return
    window.setTimeout(() => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setSelBtn(null)
        return
      }
      const range = sel.getRangeAt(0)
      if (!root.contains(range.commonAncestorContainer)) {
        setSelBtn(null)
        return
      }
      const selectedText = sel.toString().replace(/\s+/g, ' ').trim()
      if (selectedText.length < 3) {
        setSelBtn(null)
        return
      }
      const rect = range.getBoundingClientRect()
      const wrapRect = wrap.getBoundingClientRect()
      setSelBtn({
        top: rect.bottom - wrapRect.top + wrap.scrollTop + 8,
        left: Math.max(
          0,
          Math.min(rect.left - wrapRect.left, wrap.clientWidth - 200),
        ),
        selectedText,
      })
    }, 10)
  }, [])

  return (
    <div ref={wrapRef} className="relative space-y-3">
      <TtsControls
        tts={tts}
        label="Oku"
        onReadAll={() => tts.speakMarkdown(markdown)}
      />
      {tts.chunkInfo && tts.status !== 'idle' && (
        <p className="study-now-reading line-clamp-2">
          {tts.status === 'paused' ? 'Duraklatıldı · ' : 'Okunuyor · '}
          {tts.chunkInfo.text}
        </p>
      )}
      <article
        ref={articleRef}
        onMouseUp={onMouseUp}
        className="prose max-w-none select-text"
      >
        <ReactMarkdown>{markdown}</ReactMarkdown>
      </article>
      {selBtn && (
        <div
          style={{ top: selBtn.top, left: selBtn.left }}
          className="absolute z-30 flex flex-wrap gap-1.5"
        >
          <button
            type="button"
            className="btn-primary !px-3 !py-1.5 text-xs"
            onClick={() => {
              tts.speakFromSelection(markdown, selBtn.selectedText)
              setSelBtn(null)
              window.getSelection()?.removeAllRanges()
            }}
          >
            Buradan oku
          </button>
          <button
            type="button"
            className="btn-ghost !bg-white text-xs shadow-sm"
            onClick={() => {
              tts.speakPlain(selBtn.selectedText)
              setSelBtn(null)
              window.getSelection()?.removeAllRanges()
            }}
          >
            Seçimi oku
          </button>
        </div>
      )}
    </div>
  )
}
