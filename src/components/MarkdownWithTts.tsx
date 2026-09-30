import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import { useTts } from '@/hooks/useTts'
import {
  preserveSelectionOnPointerDown,
  useTextSelection,
} from '@/hooks/useTextSelection'
import TtsControls from '@/components/TtsControls'

type Props = {
  markdown: string
}

/** Read-only markdown with local TTS (shared chapter view). */
export default function MarkdownWithTts({ markdown }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef<HTMLElement>(null)
  const { ctx: selection, clear: clearSelection } =
    useTextSelection(articleRef)
  const tts = useTts()

  useEffect(() => () => tts.stop(), [])

  const selBar =
    selection && wrapRef.current
      ? (() => {
          const wrap = wrapRef.current
          const wrapRect = wrap.getBoundingClientRect()
          return {
            top:
              selection.rect.bottom - wrapRect.top + wrap.scrollTop + 8,
            left: Math.max(
              0,
              Math.min(
                selection.rect.left - wrapRect.left,
                wrap.clientWidth - 200,
              ),
            ),
            selectedText: selection.selectedText,
          }
        })()
      : null

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
      <article ref={articleRef} className="prose max-w-none select-text">
        <ReactMarkdown>{markdown}</ReactMarkdown>
      </article>
      {selBar && (
        <div
          data-selection-toolbar
          style={{ top: selBar.top, left: selBar.left }}
          className="selection-action-bar selection-action-bar--float"
        >
          <p className="selection-action-bar__preview md:hidden">
            “
            {selBar.selectedText.length > 72
              ? `${selBar.selectedText.slice(0, 72)}…`
              : selBar.selectedText}
            ”
          </p>
          <div className="selection-action-bar__actions">
            <button
              type="button"
              className="btn-primary !px-3 !py-2 text-xs"
              onPointerDown={preserveSelectionOnPointerDown}
              onClick={() => {
                tts.speakFromSelection(markdown, selBar.selectedText)
                clearSelection()
                window.getSelection()?.removeAllRanges()
              }}
            >
              Buradan oku
            </button>
            <button
              type="button"
              className="btn-ghost !bg-white text-xs shadow-sm"
              onPointerDown={preserveSelectionOnPointerDown}
              onClick={() => {
                tts.speakPlain(selBar.selectedText)
                clearSelection()
                window.getSelection()?.removeAllRanges()
              }}
            >
              Seçimi oku
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
