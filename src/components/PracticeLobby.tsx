export type PracticePick = 'quiz' | 'examples' | 'flash'

type Card = {
  id: PracticePick
  eyebrow: string
  title: string
  lead: string
  demo: PracticePick
}

const CARDS: Card[] = [
  {
    id: 'quiz',
    eyebrow: 'Sınav',
    title: 'Ünite sınavı',
    lead: 'Soru çöz, skor al. Bitince aralıklı tekrar planlanır.',
    demo: 'quiz',
  },
  {
    id: 'examples',
    eyebrow: 'Çöz',
    title: 'Çözümlü örnekler',
    lead: 'Adım adım çözüm — önce dene, sonra aç.',
    demo: 'examples',
  },
  {
    id: 'flash',
    eyebrow: 'Tekrar',
    title: 'Flash Stories',
    lead: 'Kısa kartlarla ısın. Sınav öncesi hızlı tur.',
    demo: 'flash',
  },
]

type Props = {
  chapterTitle?: string
  /** Showcase only — cards are not selectable. */
  preview?: boolean
  onPick?: (id: PracticePick) => void
}

/**
 * Alıştır hub — live preview panes; pick one to continue (no PDF).
 */
export default function PracticeLobby({
  chapterTitle,
  preview = false,
  onPick,
}: Props) {
  return (
    <section
      className={`read-lobby${preview ? ' read-lobby--preview' : ''}`}
      aria-label="Alıştır araçları"
    >
      <header className="read-lobby__head">
        <p className="read-lobby__eyebrow">Alıştır stüdyosu</p>
        <h2 className="read-lobby__title">
          {preview ? 'Nasıl pekiştireceksin?' : 'Nasıl pekiştirmek istersin?'}
        </h2>
        <p className="read-lobby__lead">
          {preview
            ? 'Aynı ünitede Alıştır da hazır: sınav, örnek, flash — üç yol.'
            : chapterTitle
              ? `“${chapterTitle}” için üç yol. Bir paneli seç — oradan devam.`
              : 'Üç yol. Bir paneli seç — oradan devam.'}
        </p>
      </header>

      <div className="read-lobby__grid read-lobby__grid--practice">
        {CARDS.map((card) => {
          const body = (
            <>
              <div className="read-lobby__stage" aria-hidden>
                {card.demo === 'quiz' ? <DemoQuiz /> : null}
                {card.demo === 'examples' ? <DemoExamples /> : null}
                {card.demo === 'flash' ? <DemoFlash /> : null}
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

function DemoQuiz() {
  return (
    <div className="read-demo read-demo--quiz">
      <p className="read-demo__q">Hücre zarının temel özelliği nedir?</p>
      <ul className="read-demo__choices">
        <li>Tamamen geçirgen</li>
        <li className="is-pick">Seçici geçirgen</li>
        <li>Sadece su geçer</li>
      </ul>
      <p className="read-demo__score">Skor · 1 / 1</p>
    </div>
  )
}

function DemoExamples() {
  return (
    <div className="read-demo read-demo--examples">
      <p className="read-demo__ex-label">Örnek</p>
      <p className="read-demo__ex-q">Glikoz hücreye nasıl girer?</p>
      <ol className="read-demo__steps">
        <li className="is-on">Taşıyıcı proteini bul</li>
        <li>Gradyanı kontrol et</li>
        <li>Sonucu yaz</li>
      </ol>
    </div>
  )
}

function DemoFlash() {
  return (
    <div className="read-demo read-demo--flash">
      <div className="read-demo__card-stack" aria-hidden>
        <span className="read-demo__flash-card is-back" />
        <span className="read-demo__flash-card is-mid" />
        <div className="read-demo__flash-card is-front">
          <p className="read-demo__flash-q">Seçici geçirgenlik?</p>
          <p className="read-demo__flash-a">Bazı moleküller geçer, bazıları durur.</p>
        </div>
      </div>
    </div>
  )
}
