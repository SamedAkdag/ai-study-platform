import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import { askAboutSelection, updateChapterMarkdownField } from '@/lib/api'
import { insertAiNoteAfterSelection, isAiNoteBlockquote } from '@/lib/aiNotes'
import { useTts } from '@/hooks/useTts'
import TtsControls from '@/components/TtsControls'

type Depth = 'brief' | 'standard' | 'detailed'

type Props = {
  chapterId: string
  chapterTitle: string
  markdown: string
  depth: Depth
  onMarkdownSaved?: () => void
  onShowInBook?: (selectedText: string) => void
}

type ChatMessage = { role: 'user' | 'assistant'; content: string }

type Bubble = {
  id: string
  selectedText: string
  precedingContext: string
  followingContext: string
  top: number
  left: number
  messages: ChatMessage[]
  draft: string
  loading: boolean
  error: string | null
  savedAnswers: Record<number, 'saving' | 'saved' | 'error'>
}

type AskButton = {
  top: number
  left: number
  selectedText: string
  precedingContext: string
  followingContext: string
}

function flattenText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenText).join('')
  if (typeof node === 'object' && node !== null && 'props' in node) {
    return flattenText(
      (node as { props?: { children?: ReactNode } }).props?.children,
    )
  }
  return ''
}

function readSelectionContext(root: HTMLElement): {
  selectedText: string
  precedingContext: string
  followingContext: string
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
  const beforeLines = before
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const precedingContext = beforeLines.slice(-20).join('\n')

  const postRange = document.createRange()
  postRange.selectNodeContents(root)
  postRange.setStart(range.endContainer, range.endOffset)
  const after = postRange.toString()
  const afterLines = after
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const followingContext = afterLines.slice(0, 20).join('\n')

  return {
    selectedText,
    precedingContext,
    followingContext,
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
  depth,
  onMarkdownSaved,
  onShowInBook,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef<HTMLElement>(null)
  const [askBtn, setAskBtn] = useState<AskButton | null>(null)
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [localMarkdown, setLocalMarkdown] = useState(markdown)
  const tts = useTts()

  useEffect(() => {
    setLocalMarkdown(markdown)
  }, [markdown])

  useEffect(() => {
    return () => tts.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stop only on unmount
  }, [])

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
        followingContext: ctx.followingContext,
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
        followingContext: askBtn.followingContext,
        top: askBtn.top,
        left: Math.min(askBtn.left, wrapRef.current!.clientWidth - 350),
        messages: [],
        draft: '',
        loading: false,
        error: null,
        savedAnswers: {},
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
        followingContext: bubble.followingContext,
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

  async function addAnswerToNotes(bubbleId: string, messageIndex: number) {
    const bubble = bubbles.find((b) => b.id === bubbleId)
    if (!bubble) return
    const msg = bubble.messages[messageIndex]
    if (!msg || msg.role !== 'assistant') return
    if (bubble.savedAnswers[messageIndex] === 'saved') return

    const question =
      [...bubble.messages]
        .slice(0, messageIndex)
        .reverse()
        .find((m) => m.role === 'user')?.content || 'Soru'

    setBubbles((prev) =>
      prev.map((b) =>
        b.id === bubbleId
          ? {
              ...b,
              savedAnswers: { ...b.savedAnswers, [messageIndex]: 'saving' },
            }
          : b,
      ),
    )

    try {
      const next = insertAiNoteAfterSelection(
        localMarkdown,
        bubble.selectedText,
        question,
        msg.content,
      )
      await updateChapterMarkdownField({
        chapterId,
        depth,
        markdown: next,
      })
      setLocalMarkdown(next)
      onMarkdownSaved?.()
      setBubbles((prev) =>
        prev.map((b) =>
          b.id === bubbleId
            ? {
                ...b,
                savedAnswers: { ...b.savedAnswers, [messageIndex]: 'saved' },
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
                savedAnswers: { ...b.savedAnswers, [messageIndex]: 'error' },
                error:
                  err instanceof Error
                    ? err.message
                    : 'Nota eklenemedi',
              }
            : b,
        ),
      )
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <p className="muted mb-3 text-xs leading-relaxed">
        Seç → sor veya oku. Cevabı “Nota ekle” ile kaydedebilirsin.
      </p>

      <div className="mb-4">
        <TtsControls
          tts={tts}
          label="Oku"
          onReadAll={() => tts.speakMarkdown(localMarkdown)}
        />
      </div>

      {tts.status !== 'idle' && tts.status !== 'unsupported' && tts.chunkInfo && (
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
        <ReactMarkdown
          components={{
            blockquote: ({ children }) => {
              const text = flattenText(children)
              const isNote = isAiNoteBlockquote(text)
              return (
                <blockquote className={isNote ? 'study-ai-note' : undefined}>
                  {children}
                </blockquote>
              )
            },
          }}
        >
          {localMarkdown}
        </ReactMarkdown>
      </article>

      {askBtn && (
        <div
          style={{ top: askBtn.top, left: askBtn.left }}
          className="absolute z-30 flex flex-wrap gap-1.5"
        >
          <button
            type="button"
            onClick={openBubble}
            className="btn-primary !px-3 !py-1.5 text-xs"
          >
            Bu kısım hakkında sor
          </button>
          <button
            type="button"
            onClick={() => {
              tts.speakFromSelection(localMarkdown, askBtn.selectedText)
              setAskBtn(null)
              window.getSelection()?.removeAllRanges()
            }}
            className="btn-ghost !bg-white text-xs shadow-sm"
          >
            Buradan oku
          </button>
          <button
            type="button"
            onClick={() => {
              tts.speakPlain(askBtn.selectedText)
              setAskBtn(null)
              window.getSelection()?.removeAllRanges()
            }}
            className="btn-ghost !bg-white text-xs shadow-sm"
          >
            Seçimi oku
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

          <div className="mb-2 max-h-52 space-y-2 overflow-y-auto text-sm">
            {b.messages.length === 0 && (
              <p className="muted text-xs">Bu seçimle ilgili sorunu yaz.</p>
            )}
            {b.messages.map((m, i) => (
              <div key={i} className="space-y-1">
                <div
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
                {m.role === 'assistant' && (
                  <button
                    type="button"
                    disabled={
                      b.savedAnswers[i] === 'saving' ||
                      b.savedAnswers[i] === 'saved'
                    }
                    onClick={() => void addAnswerToNotes(b.id, i)}
                    className="btn-ghost !px-2 !py-1 text-[11px]"
                    style={
                      b.savedAnswers[i] === 'saved'
                        ? { color: 'var(--accent-deep)' }
                        : undefined
                    }
                  >
                    {b.savedAnswers[i] === 'saving'
                      ? 'Ekleniyor…'
                      : b.savedAnswers[i] === 'saved'
                        ? 'Nota eklendi ✓'
                        : b.savedAnswers[i] === 'error'
                          ? 'Tekrar dene'
                          : 'Nota ekle'}
                  </button>
                )}
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
