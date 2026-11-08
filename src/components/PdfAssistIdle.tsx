import { useEffect, useState } from 'react'

type Props = {
  bookTitle?: string
  noteCount?: number
}

/** Autoplay storyboard — like a short how-to reel. */
type Beat =
  | 'intro'
  | 'point'
  | 'select'
  | 'toolbar'
  | 'corner'
  | 'click'
  | 'reply'
  | 'hold'

const BEATS: { id: Beat; ms: number; status: string }[] = [
  {
    id: 'intro',
    ms: 1100,
    status: 'Soldaki PDF’den bir paragraf seçersin…',
  },
  {
    id: 'point',
    ms: 1000,
    status: 'İmleç metnin üzerine gelir.',
  },
  {
    id: 'select',
    ms: 1200,
    status: 'Tıkla veya sürükle — metin vurgulanır.',
  },
  {
    id: 'toolbar',
    ms: 1300,
    status: 'Seçimin altında kısayollar çıkar.',
  },
  {
    id: 'corner',
    ms: 1100,
    status: 'Sağ üstteki AI’a sor parlar.',
  },
  {
    id: 'click',
    ms: 900,
    status: 'Bas — soru sağ panelde açılır.',
  },
  {
    id: 'reply',
    ms: 2200,
    status: 'Açıklama burada belirir; sesli de dinleyebilirsin.',
  },
  {
    id: 'hold',
    ms: 900,
    status: 'Tekrar izleniyor…',
  },
]

const DEMO_LINES = [
  'Hücre zarı seçici geçirgendir;',
  'bazı moleküller geçer, bazıları durur.',
  'Bu denge canlılık için kritiktir.',
]

const REPLY_TEXT =
  'Kısaca: zar bir kapı gibi çalışır — gerekeni alır, fazlasını tutar. Bu yüzden hücre dengede kalır.'

/**
 * Right-rail companion with looping how-to “video” demo.
 */
export default function PdfAssistIdle({ bookTitle, noteCount = 0 }: Props) {
  const [beatIdx, setBeatIdx] = useState(0)
  const [paused, setPaused] = useState(false)
  const beat = BEATS[beatIdx] ?? BEATS[0]

  useEffect(() => {
    if (paused) return
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setBeatIdx(BEATS.findIndex((b) => b.id === 'reply'))
      return
    }
    const t = window.setTimeout(() => {
      setBeatIdx((i) => (i + 1) % BEATS.length)
    }, beat.ms)
    return () => window.clearTimeout(t)
  }, [beat.ms, beatIdx, paused])

  const id = beat.id
  const selected = ['select', 'toolbar', 'corner', 'click', 'reply', 'hold'].includes(
    id,
  )
  const showToolbar = ['toolbar', 'corner', 'click'].includes(id)
  const cornerReady = ['corner', 'click', 'reply', 'hold'].includes(id)
  const cornerFired = ['click', 'reply', 'hold'].includes(id)
  const showReply = ['reply', 'hold'].includes(id)
  const showCursor = ['point', 'select', 'click'].includes(id)
  const cursorMode =
    id === 'point' ? 'hover' : id === 'select' ? 'pick' : id === 'click' ? 'tap' : ''

  return (
    <div className="pdf-assist-idle">
      <p className="pdf-assist-idle__eyebrow">AI asistan</p>
      <h2 className="pdf-assist-idle__title">
        Bir paragraf seç — üzerinde çalışayım.
      </h2>
      <p className="pdf-assist-idle__lead">
        Sol taraftaki PDF’den metin sürükle veya bir paragrafa çift tıkla. Özet,
        açıklama ve sorular burada, sayfanın yanında kalsın.
      </p>

      <div className="pdf-assist-demo" aria-label="Nasıl yapılır animasyonu">
        <div className="pdf-assist-demo__head">
          <span className="pdf-assist-demo__badge">Nasıl yapılır</span>
          <button
            type="button"
            className="pdf-assist-demo__pause"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
          >
            {paused ? 'Oynat' : 'Duraklat'}
          </button>
        </div>

        <div
          className={
            `pdf-assist-demo__page` +
            (selected ? ' is-selected' : '') +
            (showReply ? ' is-asked' : '') +
            (paused ? ' is-paused' : '')
          }
        >
          <div
            className={
              'pdf-assist-demo__corner' +
              (cornerReady ? ' is-ready' : '') +
              (cornerFired ? ' is-fired' : '')
            }
            aria-hidden
          >
            <span className="pdf-assist-demo__orb" />
            AI'a sor
          </div>

          <p className="pdf-assist-demo__page-label">s. 12 · örnek sayfa</p>

          <div
            className={
              'pdf-assist-demo__passage' + (selected ? ' is-on' : '')
            }
            aria-hidden
          >
            {DEMO_LINES.map((line) => (
              <span key={line} className="pdf-assist-demo__line">
                {line}
              </span>
            ))}
          </div>

          {showToolbar ? (
            <div className="pdf-assist-demo__toolbar" aria-hidden>
              <span
                className={
                  'pdf-assist-demo__chip is-primary' +
                  (cornerFired ? ' is-press' : '')
                }
              >
                AI'a sor
              </span>
              <span className="pdf-assist-demo__chip">Özetle</span>
              <span className="pdf-assist-demo__chip">Açıkla</span>
            </div>
          ) : null}

          {showReply ? (
            <div className="pdf-assist-demo__reply" role="status">
              <span className="pdf-assist-demo__reply-label">AI</span>
              <p>{REPLY_TEXT}</p>
            </div>
          ) : null}

          {showCursor ? (
            <span
              className={`pdf-assist-demo__cursor pdf-assist-demo__cursor--${cursorMode}`}
              aria-hidden
            />
          ) : null}

          <div className="pdf-assist-demo__progress" aria-hidden>
            {BEATS.map((b, i) => (
              <span
                key={b.id}
                className={
                  'pdf-assist-demo__dot' + (i === beatIdx ? ' is-on' : '')
                }
              />
            ))}
          </div>
        </div>

        <p className="pdf-assist-demo__status" aria-live="polite">
          {beat.status}
        </p>
      </div>

      <ul className="pdf-assist-idle__hints">
        <li>
          <span className="pdf-assist-idle__hint-key">Çift tık</span>
          <span>Paragrafı seçip AI’a sor</span>
        </li>
        <li>
          <span className="pdf-assist-idle__hint-key">Sürükle</span>
          <span>Özetle · Açıkla · Çevir · Dinle</span>
        </li>
        <li>
          <span className="pdf-assist-idle__hint-key">Üst köşe</span>
          <span>Seçimden sonra AI'a sor</span>
        </li>
      </ul>

      {bookTitle ? (
        <p className="pdf-assist-idle__meta">
          {bookTitle}
          {noteCount > 0 ? ` · ${noteCount} not` : ''}
        </p>
      ) : null}
    </div>
  )
}
