import type { PageText } from './slidingWindow'

/** Sayfada seçilebilir / OCR’süz okunabilir metin var mı? */
export function pageTextStrength(text: string | undefined | null): number {
  const t = (text || '').replace(/\s+/g, ' ').trim()
  if (!t) return 0
  // Harf/rakam oranı — bozuk OCR gürültüsünü biraz filtreler
  const alnum = (t.match(/[A-Za-zÇĞİÖŞÜçğıöşü0-9]/g) || []).length
  return Math.min(1, alnum / 80)
}

/**
 * Gerçekten OCR gerekir mi?
 * Biraz metin varsa (başlık sayfası vb.) OCR atlanır — sadece boş / neredeyse boş sayfalar.
 */
export function pageNeedsOcr(text: string | undefined | null): boolean {
  const alnum = ((text || '').match(/[A-Za-zÇĞİÖŞÜçğıöşü0-9]/g) || []).length
  return alnum < 12
}

/**
 * Kitap genelinde OCR?
 * Sadece sayfaların anlamlı bir kısmı boşsa (tarama PDF).
 * 1–2 boş kapak/arka sayfa yüzünden tüm kitap OCR’lanmaz.
 */
export function pdfNeedsOcr(pages: PageText[]): boolean {
  if (!pages.length) return true
  const weak = pages.filter((p) => pageNeedsOcr(p.text)).length
  if (weak === 0) return false
  // Çoğunluk metinliyse OCR yok; tarama PDF’te genelde %50+ boş olur
  return weak / pages.length >= 0.35
}

export function mergeOcrPages(
  base: PageText[],
  ocr: PageText[],
): PageText[] {
  const byNum = new Map(ocr.map((p) => [p.pageNumber, p.text]))
  if (!base.length) {
    return ocr.map((p) => ({
      pageNumber: p.pageNumber,
      text: p.text,
    }))
  }
  return base.map((p) => {
    if (!pageNeedsOcr(p.text)) return p
    const alt = byNum.get(p.pageNumber)
    if (alt && pageTextStrength(alt) > pageTextStrength(p.text)) {
      return { pageNumber: p.pageNumber, text: alt }
    }
    return p
  })
}
