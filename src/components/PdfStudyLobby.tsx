import { useEffect, useState } from 'react'

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
    ms: 1000,
    status: 'PDF solda kalır — sayfa hep gözünün önünde.',
  },
  {
    id: 'point',
    ms: 950,
    status: 'İmleç metnin üzerine gelir.',
  },
  {
    id: 'select',
    ms: 1150,
    status: 'Paragrafı seç — vurgu belirir.',
  },
  {
    id: 'toolbar',
    ms: 1250,
    status: 'Seçimin altında kısayollar: AI’a sor · Özetle · Açıkla.',
  },
  {
    id: 'corner',
    ms: 1050,
    status: 'Sağ üstteki AI’a sor parlar.',
  },
  {
    id: 'click',
    ms: 850,
    status: 'Bas — cevap sağdaki sticky asistan panelinde açılır.',
  },
  {
    id: 'reply',
    ms: 2400,
    status: 'Açıklama sayfanın yanında; sesli de dinleyebilirsin.',
  },
  {
    id: 'hold',
    ms: 850,
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

const FEATURES = [
  {
    eye: 'Seç',
    title: 'AI’a sor',
    lead: 'Paragrafı sürükle veya çift tıkla — soru sayfanın yanında cevaplanır.',
  },
  {
    eye: 'Yanında',
    title: 'Sticky asistan',
    lead: 'PDF kaybolmaz. Özet, açıklama ve notlar sağ rayda kalır.',
  },
  {
    eye: 'Sonra',
    title: 'Anlatım & Alıştır',
    lead: 'Aynı üniteden zihin haritası, dinle, quiz ve flash açılır.',
  },
]

/**
 * Upload showcase — PDF desk + Ask AI storyboard (preview only).
 */
export default function PdfStudyLobby() {
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
  const selected = [
    'select',
    'toolbar',
    'corner',
    'click',
    'reply',
    'hold',
  ].includes(id)
  const showToolbar = ['toolbar', 'corner', 'click'].includes(id)
  const cornerReady = ['corner', 'click', 'reply', 'hold'].includes(id)
  const cornerFired = ['click', 'reply', 'hold'].includes(id)
  const showReply = ['reply', 'hold'].includes(id)
  const showCursor = ['point', 'select', 'click'].includes(id)
  const cursorMode =
    id === 'point' ? 'hover' : id === 'select' ? 'pick' : id === 'click' ? 'tap' : ''
  const railLive = ['click', 'reply', 'hold'].includes(id)

  return (
    <section
      className="read-lobby read-lobby--preview pdf-desk-lobby"
      aria-label="PDF’den çalışma"
    >
      <header className="read-lobby__head">
        <p className="read-lobby__eyebrow">PDF masası</p>
        <h2 className="read-lobby__title">PDF’den nasıl çalışırsın?</h2>
        <p className="read-lobby__lead">
          Metni seç, AI’a sor — cevap sayfanın yanında açılır. Kaynak hep
          gözünün önünde kalır.
        </p>
      </header>

      <div className="pdf-desk-demo" aria-label="PDF’den çalışma animasyonu">
        <div className="pdf-desk-demo__head">
          <span className="pdf-desk-demo__badge">Canlı örnek</span>
          <button
            type="button"
            className="pdf-desk-demo__pause"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
          >
            {paused ? 'Oynat' : 'Duraklat'}
          </button>
        </div>

        <div
          className={
            'pdf-desk-demo__stage' +
            (showReply ? ' is-asked' : '') +
            (paused ? ' is-paused' : '')
          }
        >
          <div
            className={
              'pdf-desk-demo__page' + (selected ? ' is-selected' : '')
            }
          >
            <div
              className={
                'pdf-desk-demo__corner' +
                (cornerReady ? ' is-ready' : '') +
                (cornerFired ? ' is-fired' : '')
              }
              aria-hidden
            >
              <span className="pdf-desk-demo__orb" />
              AI'a sor
            </div>

            <p className="pdf-desk-demo__page-label">s. 12 · örnek sayfa</p>

            <div
              className={
                'pdf-desk-demo__passage' + (selected ? ' is-on' : '')
              }
              aria-hidden
            >
              {DEMO_LINES.map((line) => (
                <span key={line} className="pdf-desk-demo__line">
                  {line}
                </span>
              ))}
            </div>

            {showToolbar ? (
              <div className="pdf-desk-demo__toolbar" aria-hidden>
                <span
                  className={
                    'pdf-desk-demo__chip is-primary' +
                    (cornerFired ? ' is-press' : '')
                  }
                >
                  AI'a sor
                </span>
                <span className="pdf-desk-demo__chip">Özetle</span>
                <span className="pdf-desk-demo__chip">Açıkla</span>
                <span className="pdf-desk-demo__chip">Dinle</span>
              </div>
            ) : null}

            {showCursor ? (
              <span
                className={`pdf-desk-demo__cursor pdf-desk-demo__cursor--${cursorMode}`}
                aria-hidden
              />
            ) : null}
          </div>

          <aside
            className={
              'pdf-desk-demo__rail' + (railLive ? ' is-live' : '')
            }
            aria-hidden={!showReply}
          >
            <p className="pdf-desk-demo__rail-eye">AI asistan</p>
            {!showReply ? (
              <div className="pdf-desk-demo__rail-idle">
                <span className="pdf-desk-demo__rail-orb" />
                <p>Bir paragraf seç — üzerinde çalışayım.</p>
              </div>
            ) : (
              <div className="pdf-desk-demo__reply" role="status">
                <span className="pdf-desk-demo__reply-label">AI</span>
                <p>{REPLY_TEXT}</p>
                <span className="pdf-desk-demo__listen">Dinle · tekrar</span>
              </div>
            )}
          </aside>

          <div className="pdf-desk-demo__progress" aria-hidden>
            {BEATS.map((b, i) => (
              <span
                key={b.id}
                className={
                  'pdf-desk-demo__dot' + (i === beatIdx ? ' is-on' : '')
                }
              />
            ))}
          </div>
        </div>

        <p className="pdf-desk-demo__status" aria-live="polite">
          {beat.status}
        </p>
      </div>

      <div className="pdf-desk-lobby__features">
        {FEATURES.map((f) => (
          <div key={f.title} className="pdf-desk-lobby__feat">
            <p className="pdf-desk-lobby__feat-eye">{f.eye}</p>
            <p className="pdf-desk-lobby__feat-title">{f.title}</p>
            <p className="pdf-desk-lobby__feat-lead">{f.lead}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
