import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  flashcardsFromNotes,
  type Flashcard,
} from '@/lib/flashcardsFromNotes'
import {
  getStoredLang,
  getStoredRate,
  getStoredVoiceUri,
  isTtsSupported,
  speakText,
  stopSpeech,
  type TtsStatus,
} from '@/lib/tts'
import type { FlashcardItem, QuizItem } from '@/types/database'

type Props = {
  open: boolean
  onClose: () => void
  title: string
  markdown: string
  keyConcepts?: string[] | null
  quiz?: QuizItem[] | null
  aiFlashcards?: FlashcardItem[] | null
  /** Fired when the learner finishes the last card (deck complete). */
  onDeckComplete?: () => void
}

const TONES = [
  'flash-story--a',
  'flash-story--b',
  'flash-story--c',
  'flash-story--d',
] as const

function toneForCard(card: Flashcard | null, index: number): string {
  if (card?.role === 'hook') return 'flash-story--b'
  if (card?.role === 'teach') return 'flash-story--a'
  if (card?.role === 'concept') return 'flash-story--d'
  if (card?.role === 'check') return 'flash-story--c'
  if (card?.role === 'trap') return 'flash-story--b'
  if (card?.role === 'summary') return 'flash-story--a'
  return TONES[index % TONES.length]!
}

/** Instagram Stories–style flashcards derived from AI study notes + TTS. */
export default function FlashcardStories({
  open,
  onClose,
  title,
  markdown,
  keyConcepts,
  quiz,
  aiFlashcards,
  onDeckComplete,
}: Props) {
  const cards = useMemo(
    () =>
      flashcardsFromNotes({
        title,
        markdown,
        keyConcepts,
        quiz,
        aiFlashcards,
      }),
    [title, markdown, keyConcepts, quiz, aiFlashcards],
  )

  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [autoSpeak, setAutoSpeak] = useState(true)
  const [canScrollMore, setCanScrollMore] = useState(false)
  const [ttsStatus, setTtsStatus] = useState<TtsStatus>(
    isTtsSupported() ? 'idle' : 'unsupported',
  )
  const touchX = useRef<number | null>(null)
  const touchY = useRef<number | null>(null)
  const didScrollCard = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const indexRef = useRef(0)
  const autoSpeakRef = useRef(autoSpeak)
  const openRef = useRef(open)
  const cardIdRef = useRef<string | null>(null)
  const cardsLenRef = useRef(cards.length)
  const onCloseRef = useRef(onClose)
  const onDeckCompleteRef = useRef(onDeckComplete)
  onDeckCompleteRef.current = onDeckComplete

  function updateScrollHint() {
    const el = scrollRef.current
    if (!el) {
      setCanScrollMore(false)
      return
    }
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
    setCanScrollMore(remaining > 8)
  }

  indexRef.current = index
  autoSpeakRef.current = autoSpeak
  openRef.current = open
  cardsLenRef.current = cards.length
  onCloseRef.current = onClose

  const card = cards[index] ?? null
  cardIdRef.current = card?.id ?? null

  const phaseCards = card?.phase
    ? cards.filter((c) => c.phase === card.phase)
    : []
  const phaseIndex = card
    ? phaseCards.findIndex((c) => c.id === card.id) + 1
    : 0

  useEffect(() => {
    if (!open) return
    setIndex(0)
    setFlipped(false)
  }, [open, title])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = 0
    didScrollCard.current = false
    const frame = window.requestAnimationFrame(() => updateScrollHint())
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => updateScrollHint())
        : null
    ro?.observe(el)
    return () => {
      window.cancelAnimationFrame(frame)
      ro?.disconnect()
    }
  }, [open, index, flipped, card?.id])

  useEffect(() => {
    if (!open) {
      stopSpeech()
      setTtsStatus('idle')
      return
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault()
        go(1)
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        go(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      stopSpeech()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose])

  useEffect(() => {
    if (!open || !card || !autoSpeak) return
    setFlipped(false)
    const t = window.setTimeout(() => {
      speakCard(card, true)
    }, 200)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, autoSpeak, card?.id])

  function go(delta: number) {
    stopSpeech()
    setTtsStatus('idle')
    setFlipped(false)
    setIndex((i) => {
      const next = i + delta
      if (next < 0) return 0
      if (next >= cardsLenRef.current) {
        onDeckCompleteRef.current?.()
        onCloseRef.current()
        return i
      }
      return next
    })
  }

  function speakCard(c: Flashcard, advanceWhenDone: boolean) {
    const text =
      flipped && c.back ? `${c.front}. ${c.back}` : c.speech || c.front
    const startedForId = c.id
    speakText(text, {
      rate: getStoredRate(),
      voiceUri: getStoredVoiceUri(),
      lang: getStoredLang(),
      onStatus: setTtsStatus,
      onEnd: () => {
        setTtsStatus('idle')
        if (!advanceWhenDone || !autoSpeakRef.current || !openRef.current) return
        if (cardIdRef.current !== startedForId) return
        if (indexRef.current < cardsLenRef.current - 1) go(1)
      },
    })
  }

  if (!open) return null

  const node = (
    <div
      className="flash-stories"
      role="dialog"
      aria-modal="true"
      aria-label="Flash kartlar"
    >
      <div className={`flash-story ${toneForCard(card, index)}`}>
        <div className="flash-story__progress" aria-hidden>
          {cards.map((c, i) => (
            <span
              key={c.id}
              className={
                i < index
                  ? 'flash-story__seg is-done'
                  : i === index
                    ? 'flash-story__seg is-active'
                    : 'flash-story__seg'
              }
              data-role={c.role || ''}
            />
          ))}
        </div>

        <header className="flash-story__top">
          <div>
            <p className="flash-story__book">{title}</p>
            <p className="flash-story__count">
              {cards.length ? `${index + 1} / ${cards.length}` : '0'}
              {card?.phase
                ? ` · ${card.phase}${
                    phaseCards.length > 1 ? ` ${phaseIndex}/${phaseCards.length}` : ''
                  }`
                : ''}
            </p>
          </div>
          <button type="button" className="flash-story__close" onClick={onClose}>
            Kapat
          </button>
        </header>

        {!card ? (
          <div className="flash-story__empty">
            Bu ünitede flash kart için yeterli not yok.
          </div>
        ) : (
          <div
            className="flash-story__stage"
            onTouchStart={(e) => {
              touchX.current = e.changedTouches[0]?.clientX ?? null
              touchY.current = e.changedTouches[0]?.clientY ?? null
            }}
            onTouchEnd={(e) => {
              const x0 = touchX.current
              const y0 = touchY.current
              const x1 = e.changedTouches[0]?.clientX
              const y1 = e.changedTouches[0]?.clientY
              touchX.current = null
              touchY.current = null
              if (x0 == null || x1 == null || y0 == null || y1 == null) return
              const dx = x1 - x0
              const dy = y1 - y0
              // Vertical scroll on the card — don't change slides
              if (Math.abs(dy) > Math.abs(dx)) return
              if (Math.abs(dx) < 48) return
              go(dx < 0 ? 1 : -1)
            }}
          >
            <button
              type="button"
              className="flash-story__hit flash-story__hit--prev"
              aria-label="Önceki"
              onClick={() => go(-1)}
            />
            <button
              type="button"
              className="flash-story__hit flash-story__hit--next"
              aria-label="Sonraki"
              onClick={() => go(1)}
            />

            <article
              className={`flash-story__card ${flipped ? 'is-flipped' : ''} ${
                canScrollMore ? 'has-more' : ''
              }`}
              onClick={(e) => {
                e.stopPropagation()
                if (didScrollCard.current) {
                  didScrollCard.current = false
                  return
                }
                if (card.back) setFlipped((f) => !f)
              }}
            >
              <div
                ref={scrollRef}
                className="flash-story__scroll"
                onScroll={() => {
                  didScrollCard.current = true
                  updateScrollHint()
                }}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
              >
                <p className="flash-story__label">
                  {card.label}
                  {card.role === 'teach'
                    ? ' · konu'
                    : card.role === 'check'
                      ? ' · soru'
                      : ''}
                </p>
                <h2 className="flash-story__front">{card.front}</h2>
                {card.back ? (
                  <p className="flash-story__back">
                    {flipped
                      ? card.back
                      : card.role === 'teach'
                        ? 'Dokun → kısa anlatım'
                        : card.role === 'check'
                          ? 'Önce düşün, dokun → cevap'
                          : 'Dokun → cevap / açıklama'}
                  </p>
                ) : null}
              </div>
              {canScrollMore ? (
                <p className="flash-story__hint" aria-hidden>
                  ↓ Kaydırarak devamını oku
                </p>
              ) : null}
            </article>
          </div>
        )}

        <footer className="flash-story__bar">
          <label className="flash-story__auto">
            <input
              type="checkbox"
              checked={autoSpeak}
              onChange={(e) => {
                const on = e.target.checked
                setAutoSpeak(on)
                if (!on) stopSpeech()
              }}
            />
            Otomatik oku
          </label>
          <div className="flash-story__tts">
            {ttsStatus === 'speaking' || ttsStatus === 'paused' ? (
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  stopSpeech()
                  setTtsStatus('idle')
                }}
              >
                Durdur
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary !px-3 !py-1.5 text-xs"
                disabled={!card || ttsStatus === 'unsupported'}
                onClick={() => card && speakCard(card, false)}
              >
                Sesli oku
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  )

  return createPortal(node, document.body)
}
