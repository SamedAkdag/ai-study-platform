import type { MindMapData } from '@/types/database'
import { buildLessonSteps } from '@/lib/mindmapLesson/buildTimeline'
import { fillMindMapNarrations } from '@/lib/mindmapLesson/fillNarrations'

/** Tiny sample map for offline / UI demos (no AI). */
export const DEMO_MIND_MAP: MindMapData = {
  central: 'Fotosentez',
  narration:
    'Fotosentez, yeşil bitkilerin ışık enerjisini kimyasal enerjiye çevirdiği temel süreçtir. Bu derste ışığın yakalanmasından şeker üretimine kadar ana adımları birlikte ve sırayla gezeceğiz.',
  branches: [
    {
      label: 'Işık tepkimeleri',
      narration:
        'Işık tepkimeleri kloroplastın tilakoid zarında gerçekleşir. Işık enerjisi elektronları yükseltir; su parçalanır, oksijen açığa çıkar ve ATP ile NADPH üretilir.',
      children: ['Klorofil', 'Elektron zinciri'],
      child_narrations: [
        'Klorofil, ışığı soğuran yeşil pigmenttir. Özellikle mavi ve kırmızı dalga boylarını emer; yeşili yansıtır.',
        'Elektron zinciri, enerjili elektronların protein kompleksleri boyunca aktarılmasıdır. Bu akış proton gradyanı ve ATP sentezini besler.',
      ],
    },
    {
      label: 'Karanlık tepkimeler',
      narration:
        'Karanlık tepkimeler yani Calvin döngüsü stromada yürür. ATP ve NADPH kullanılarak karbondioksit şekere bağlanır; ışık gerekmez ama ürünleri ışık tepkimelerine bağlıdır.',
      children: ['Rubisco', 'Glikoz'],
      child_narrations: [
        'Rubisco, karbondioksiti RuBP’ye bağlayan ana enzimdir. Yavaş çalışır ama hücrede miktarı yüksektir; Calvin döngüsünün kilit adımıdır.',
        'Glikoz, döngünün sonunda oluşan şeker birimidir. Bitki bunu nişasta veya sakkaroza çevirerek depolar ve taşır.',
      ],
    },
    {
      label: 'Önemi',
      narration:
        'Fotosentez atmosferdeki oksijeni yeniler ve besin zincirinin temelini oluşturur. Tarım ve iklim tartışmalarında da merkezî bir süreçtir.',
      children: ['Oksijen', 'Besin'],
      child_narrations: [
        'Oksijen, suyun parçalanmasından gelir ve solunum için gereklidir; atmosferi yenileyen yan üründür.',
        'Besin olarak üretilen şekerler hem bitkinin kendisine hem de tüketicilere enerji sağlar.',
      ],
    },
  ],
}

export const DEMO_MARKDOWN = `## Fotosentez
Bitkiler ışıkla şeker üretir.

## Işık tepkimeleri
Tilakoidde ATP ve NADPH oluşur. Klorofil ışığı emer. Elektron zinciri proton pompalar.

## Karanlık tepkimeler
Calvin döngüsü stromada CO₂ bağlar. Rubisco ana enzimdir. Ürün glikozdur.

## Önemi
Oksijen üretir, besin zincirini besler.
`

/** Build demo steps without TTS (unit-test / console check). */
export function buildDemoLessonSteps() {
  const filled = fillMindMapNarrations(DEMO_MIND_MAP, DEMO_MARKDOWN, 'Fotosentez')
  return buildLessonSteps(filled, {
    markdown: DEMO_MARKDOWN,
    unitTitle: 'Fotosentez',
  })
}
