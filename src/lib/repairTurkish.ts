/**
 * PDF / yanlış encoding kaynaklı Türkçe karakter bozulmalarını onar.
 * Klasik: Win-1254→Latin-1 (ý→ı), UTF-8 mojibake, � → i/ı (sesli uyumu).
 */
export function repairTurkishText(input: string): string {
  if (input == null || input === '') return ''

  let s = String(input).normalize('NFC')

  const utf8Mojibake: Array<[RegExp, string]> = [
    [/Ä±/g, 'ı'],
    [/Ä°/g, 'İ'],
    [/ÄŸ/g, 'ğ'],
    [/Äž/g, 'Ğ'],
    [/ÅŸ/g, 'ş'],
    [/Åž/g, 'Ş'],
    [/Ã¼/g, 'ü'],
    [/Ãœ/g, 'Ü'],
    [/Ã¶/g, 'ö'],
    [/Ã–/g, 'Ö'],
    [/Ã§/g, 'ç'],
    [/Ã‡/g, 'Ç'],
  ]
  for (const [re, ch] of utf8Mojibake) s = s.replace(re, ch)

  const cp1254AsLatin1: Array<[RegExp, string]> = [
    [/ý/g, 'ı'],
    [/Ý/g, 'İ'],
    [/ð/g, 'ğ'],
    [/Ð/g, 'Ğ'],
    [/þ/g, 'ş'],
    [/Þ/g, 'Ş'],
  ]
  for (const [re, ch] of cp1254AsLatin1) s = s.replace(re, ch)

  // Kelime içi � → "i" (itibar, gibi)
  s = s.replace(
    /([A-Za-zÇĞİÖŞÜçğıöşü])\uFFFD([A-Za-zÇĞİÖŞÜçğıöşü])/g,
    (_, a: string, b: string) => `${a}i${b}`,
  )

  // Kalan � (çoğunlukla kelime sonu) → sesli uyumu
  s = s.replace(/\uFFFD/g, (_ch, offset: number, full: string) => {
    const before = full.slice(Math.max(0, offset - 24), offset)
    const m = before.match(/[A-Za-zÇĞİÖŞÜçğıöşü]+$/i)
    const stem = m?.[0] || ''
    const vowels = stem.match(/[aeıioöuüAEIİOÖUÜ]/g) || []
    const last = vowels[vowels.length - 1] || 'a'
    return /[eiöüEİÖÜ]/.test(last) ? 'i' : 'ı'
  })

  return s.normalize('NFC')
}
