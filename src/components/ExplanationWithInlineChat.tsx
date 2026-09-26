import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { askAboutSelection } from '@/lib/api'

type Props = {
  chapterId: string
  chapterTitle: string
  markdown: string
  onShowInBook?: (selectedText: string) => void
}

type ChatMessage = { role: 'user' | 'assistant'; content: string }

type Bubble = {
  id: string
  selectedText: string
  precedingContext: string
  top: number
  left: number
  messages: ChatMessage[]
  draft: string
  loading: boolean
  error: string | null
}

type AskButton = {
  top: number
  left: number
  selectedText: string
  precedingContext: string
}

function readSelectionContext(root: HTMLElement): {
  selectedText: string
  precedingContext: string
  rect: DOMRect
} | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null

  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null

  const selectedText = sel.toString().replace(/\s+/g, ' ').trim()
  if (selectedText.length < 3) return null

  const preRange = document.createRange()
  preRange.selectNodeContents(root)
  preRange.setEnd(range.startContainer, range.startOffset)
  const before = preRange.toString()
  const lines = before
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const precedingContext = lines.slice(-10).join('\n')

  return {
    selectedText,
    precedingContext,
    rect: range.getBoundingClientRect(),
  }
}

function toLocalPoint(
  wrap: HTMLElement,
  rect: DOMRect,
): { top: number; left: number } {
  const wrapRect = wrap.getBoundingClientRect()
  return {
    top: rect.bottom - wrapRect.top + wrap.scrollTop + 8,
    left: Math.max(0, rect.left - wrapRect.left),
  }
}

export default function ExplanationWithInlineChat({
  chapterId,
  chapterTitle,
  markdown,
  onShowInBook,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef<HTMLElement>(null)
  const [askBtn, setAskBtn] = useState<AskButton | null>(null)
  const [bubbles, setBubbles] = useState<Bubble[]>([])

  const onMouseUp = useCallback(() => {
    const root = articleRef.current
    const wrap = wrapRef.current
    if (!root || !wrap) return

    window.setTimeout(() => {
      const ctx = readSelectionContext(root)
      if (!ctx) {
        setAskBtn(null)
        return
      }

      const pos = toLocalPoint(wrap, ctx.rect)
      setAskBtn({
        ...pos,
        left: Math.min(pos.left, wrap.clientWidth - 170),
        selectedText: ctx.selectedText,
        precedingContext: ctx.precedingContext,
      })
    }, 10)
  }, [])

  useEffect(() => {
    const onScroll = () => setAskBtn(null)
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [])

  function openBubble() {
    if (!askBtn || !wrapRef.current) return
    setBubbles((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        selectedText: askBtn.selectedText,
        precedingContext: askBtn.precedingContext,
        top: askBtn.top,
        left: Math.min(askBtn.left, wrapRef.current!.clientWidth - 350),
        messages: [],
        draft: '',
        loading: false,
        error: null,
      },
    ])
    setAskBtn(null)
    window.getSelection()?.removeAllRanges()
  }

  async function sendMessage(bubbleId: string) {
    const bubble = bubbles.find((b) => b.id === bubbleId)
    if (!bubble || !bubble.draft.trim() || bubble.loading) return

    const question = bubble.draft.trim()
    const history = bubble.messages

    setBubbles((prev) =>
      prev.map((b) =>
        b.id === bubbleId
          ? {
              ...b,
              draft: '',
              loading: true,
              error: null,
              messages: [...b.messages, { role: 'user', content: question }],
            }
          : b,
      ),
    )

    try {
      const answer = await askAboutSelection({
        chapterId,
        chapterTitle,
        selectedText: bubble.selectedText,
        precedingContext: bubble.precedingContext,
        question,
        history,
      })

      setBubbles((prev) =>
        prev.map((b) =>
          b.id === bubbleId
            ? {
                ...b,
                loading: false,
                messages: [...b.messages, { role: 'assistant', content: answer }],
              }
            : b,
        ),
      )
    } catch (err) {
      setBubbles((prev) =>
        prev.map((b) =>
          b.id === bubbleId
            ? {
                ...b,
                loading: false,
                error: err instanceof Error ? err.message : 'Soru başarısız',
              }
            : b,
        ),
      )
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <p className="muted mb-4 text-xs leading-relaxed">
        Metni seç → soru sor veya kitaptaki ilgili kesiti aç. AI yalnızca seçim +
        önceki ~10 satırı kullanır.
      </p>

      <article
        ref={articleRef}
        onMouseUp={onMouseUp}
        className="prose max-w-none select-text"
      >
        <ReactMarkdown>{markdown}</ReactMarkdown>
      </article>

      {askBtn && (
        <div
          style={{ top: askBtn.top, left: askBtn.left }}
          className="absolute z-30 flex flex-wrap gap-1.5"
        >
          <button type="button" onClick={openBubble} className="btn-primary !px-3 !py-1.5 text-xs">
            Bu kısım hakkında sor
          </button>
          {onShowInBook && (
            <button
              type="button"
              onClick={() => {
                onShowInBook(askBtn.selectedText)
                setAskBtn(null)
                window.getSelection()?.removeAllRanges()
              }}
              className="btn-ghost !bg-white text-xs shadow-sm"
            >
              Kitapta göster
            </button>
          )}
        </div>
      )}

      {bubbles.map((b) => (
        <div
          key={b.id}
          style={{ top: b.top, left: b.left, width: 340 }}
          className="surface-panel absolute z-40 p-3.5"
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <p className="muted line-clamp-2 text-xs">
              Seçim: “{b.selectedText}”
            </p>
            <button
              type="button"
              onClick={() =>
                setBubbles((prev) => prev.filter((x) => x.id !== b.id))
              }
              className="muted text-xs hover:opacity-80"
            >
              Kapat
            </button>
          </div>

          <div className="mb-2 max-h-48 space-y-2 overflow-y-auto text-sm">
            {b.messages.length === 0 && (
              <p className="muted text-xs">Bu seçimle ilgili sorunu yaz.</p>
            )}
            {b.messages.map((m, i) => (
              <div
                key={i}
                className="rounded-lg px-2.5 py-1.5 text-xs whitespace-pre-wrap"
                style={
                  m.role === 'user'
                    ? { background: 'var(--ink)', color: '#f5f8fb' }
                    : {
                        background: 'var(--accent-soft)',
                        color: 'var(--accent-deep)',
                      }
                }
              >
                {m.content}
              </div>
            ))}
            {b.loading && <p className="muted text-xs">AI yanıtlıyor…</p>}
            {b.error && (
              <p className="text-xs" style={{ color: 'var(--danger)' }}>
                {b.error}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <input
              value={b.draft}
              onChange={(e) =>
                setBubbles((prev) =>
                  prev.map((x) =>
                    x.id === b.id ? { ...x, draft: e.target.value } : x,
                  ),
                )
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') void sendMessage(b.id)
              }}
              placeholder="Sorunu yaz…"
              className="field !py-1.5 text-xs"
            />
            <button
              type="button"
              disabled={b.loading || !b.draft.trim()}
              onClick={() => void sendMessage(b.id)}
              className="btn-primary !px-2.5 !py-1.5 text-xs"
            >
              Gönder
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
