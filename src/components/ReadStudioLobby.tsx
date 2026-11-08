import type { ReadStudioTab } from '@/components/study/StudyRightStudio'

export type ReadStudioPick = Exclude<ReadStudioTab, 'hub'>

type Card = {
  id: ReadStudioPick
  eyebrow: string
  title: string
  lead: string
  demo: 'prose' | 'map' | 'guide' | 'audio'
}

const CARDS: Card[] = [
  {
    id: 'prose',
    eyebrow: 'Oku',
    title: 'Anlatım',
    lead: 'Konuyu öğrenci dilinde, satır satır oku. Metinden soru sor.',
    demo: 'prose',
  },
  {
    id: 'map',
    eyebrow: 'Gör',
    title: 'Zihin haritası',
    lead: 'Kavramları dallarla gez. Düğüme tıkla, PDF’ye atla.',
    demo: 'map',
  },
  {
    id: 'guide',
    eyebrow: 'Planla',
    title: 'Kılavuz',
    lead: 'Ne çalışacağını sıraya koy: kavramlar, quiz, kontrol listesi.',
    demo: 'guide',
  },
  {
    id: 'audio',
    eyebrow: 'Dinle',
    title: 'Dersi dinle',
    lead: 'Hoca haritada yürür — kamera, karaoke, ara verip sor.',
    demo: 'audio',
  },
]

type Props = {
  chapterTitle?: string
  /** Showcase only — cards are not selectable. */
  preview?: boolean
  onPick?: (id: ReadStudioPick) => void
}

/**
 * Anlatım hub — 4 live preview panes; pick one to continue.
 */
export default function ReadStudioLobby({
  chapterTitle,
  preview = false,
  onPick,
}: Props) {
  return (
    <section
      className={`read-lobby${preview ? ' read-lobby--preview' : ''}`}
      aria-label="Anlatım araçları"
    >
      <header className="read-lobby__head">
        <p className="read-lobby__eyebrow">Anlatım stüdyosu</p>
        <h2 className="read-lobby__title">
          {preview ? 'Nasıl öğreneceksin?' : 'Nasıl öğrenmek istersin?'}
        </h2>
        <p className="read-lobby__lead">
          {preview
            ? 'Kaynağını seçince Anlatım bunlarla açılır — dört yol, sen seçersin.'
            : chapterTitle
              ? `“${chapterTitle}” için dört yol. Bir paneli seç — oradan devam.`
              : 'Dört yol. Bir paneli seç — oradan devam.'}
        </p>
      </header>

      <div className="read-lobby__grid">
        {CARDS.map((card) => {
          const body = (
            <>
              <div className="read-lobby__stage" aria-hidden>
                {card.demo === 'prose' ? <DemoProse /> : null}
                {card.demo === 'map' ? <DemoMap /> : null}
                {card.demo === 'guide' ? <DemoGuide /> : null}
                {card.demo === 'audio' ? <DemoAudio /> : null}
              </div>
              <div className="read-lobby__meta">
                <p className="read-lobby__card-eye">{card.eyebrow}</p>
                <p className="read-lobby__card-title">{card.title}</p>
                <p className="read-lobby__card-lead">{card.lead}</p>
                {!preview ? (
                  <span className="read-lobby__go">Seç · devam et</span>
                ) : null}
              </div>
            </>
          )

          if (preview) {
            return (
              <div
                key={card.id}
                className={`read-lobby__card read-lobby__card--${card.demo} read-lobby__card--static`}
              >
                {body}
              </div>
            )
          }

          return (
            <button
              key={card.id}
              type="button"
              className={`read-lobby__card read-lobby__card--${card.demo}`}
              onClick={() => onPick?.(card.id)}
            >
              {body}
            </button>
          )
        })}
      </div>
    </section>
  )
}

function DemoProse() {
  return (
    <div className="read-demo read-demo--prose">
      <div className="read-demo__scroll">
        <p className="read-demo__kicker">Özet</p>
        <p>
          Hücre zarı seçici geçirgendir; gereken molekülleri alır, fazlasını
          tutar.
        </p>
        <p className="is-hi">Bu denge canlılık için kritiktir.</p>
        <p>
          Basit benzetme: kapı görevlisi — tanıdığını içeri alır, yabancıyı
          dışarıda bırakır.
        </p>
      </div>
    </div>
  )
}

function DemoMap() {
  return (
    <div className="read-demo read-demo--map">
      <span className="read-demo__node read-demo__node--c">Konu</span>
      <span className="read-demo__node read-demo__node--a">Tanım</span>
      <span className="read-demo__node read-demo__node--b">Örnek</span>
      <span className="read-demo__node read-demo__node--d">Sonuç</span>
      <span className="read-demo__edge read-demo__edge--1" />
      <span className="read-demo__edge read-demo__edge--2" />
      <span className="read-demo__edge read-demo__edge--3" />
    </div>
  )
}

function DemoGuide() {
  return (
    <div className="read-demo read-demo--guide">
      <ul>
        <li className="is-done">Ana kavramları oku</li>
        <li className="is-now">2 örnek çöz</li>
        <li>Kısa quiz</li>
        <li>Flash ile pekiştir</li>
      </ul>
    </div>
  )
}

function DemoAudio() {
  return (
    <div className="read-demo read-demo--audio">
      <div className="read-demo__eq" aria-hidden>
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <p className="read-demo__karaoke">
        <span>“Şimdi şu dala bak —</span>
        <span className="is-on"> burası sınavın sevdiği kısım.”</span>
      </p>
    </div>
  )
}
