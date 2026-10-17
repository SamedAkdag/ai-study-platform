import { Link } from 'react-router-dom'

type Teaser = { name: string; body: string }

type Props = {
  title?: string
  /** Chapter title used to flavour teaser copy */
  chapterTitle?: string
  /** Where “Giriş Yap” should send the user */
  signInHint?: string
}

const BASE_TEASERS: Teaser[] = [
  {
    name: 'Ayşe',
    body: 'Bu kısımda teminat oranı düşerse ne olur, netleştirebildin mi?',
  },
  {
    name: 'Mert',
    body: 'Ben özet kartındaki 2. cümleyi quiz’e çevirdim — süper tuttu.',
  },
]

/**
 * Soft-gated group chat preview: 2 clear messages + blurred rest + CTA.
 * No invite-wall copy — curiosity first.
 */
export default function BlurredChat({
  title = 'Grup sohbeti',
  chapterTitle,
}: Props) {
  const teasers: Teaser[] = [
    BASE_TEASERS[0],
    {
      name: BASE_TEASERS[1].name,
      body: chapterTitle
        ? `“${chapterTitle.slice(0, 42)}${chapterTitle.length > 42 ? '…' : ''}” için bir soru yazdım, bakılır mı?`
        : BASE_TEASERS[1].body,
    },
  ]

  const blurred = [
    { name: 'Zeynep', body: 'Ben de aynı yerde takıldım, örnek ister misin?' },
    { name: 'Can', body: 'Hocanın anlattığı formülü buraya not düştüm…' },
    { name: 'Elif', body: 'Yarınki quiz’de bu çıkabilir, tekrar edelim.' },
  ]

  return (
    <section className="blur-chat surface-panel p-4 sm:p-5" aria-label={title}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">{title}</p>
        <p className="muted text-[11px]">Canlı tartışma</p>
      </div>

      <div className="blur-chat__list space-y-2.5">
        {teasers.map((m) => (
          <div key={m.name + m.body.slice(0, 12)} className="blur-chat__msg">
            <p className="text-xs font-semibold">{m.name}</p>
            <p className="mt-0.5 text-sm leading-relaxed">{m.body}</p>
          </div>
        ))}

        <div className="blur-chat__gated relative">
          <div className="blur-chat__fog space-y-2.5" aria-hidden>
            {blurred.map((m) => (
              <div key={m.name} className="blur-chat__msg">
                <p className="text-xs font-semibold">{m.name}</p>
                <p className="mt-0.5 text-sm leading-relaxed">{m.body}</p>
              </div>
            ))}
          </div>
          <div className="blur-chat__cta">
            <p className="text-sm font-semibold">Devamı merak mı etti?</p>
            <p className="muted mt-1 text-xs leading-relaxed">
              Sohbete katıl, soru sor — kayıt ücretsiz.
            </p>
            <Link to="/" className="btn-primary mt-3 inline-flex text-sm">
              Giriş Yap
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
