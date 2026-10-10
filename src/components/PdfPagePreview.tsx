import { useEffect, useState } from 'react'
import { pdfjsLib, ensurePdfWorker } from '@/lib/pdfjs'

type Props = {
  src: string
  pageNumber: number
  className?: string
}

type ExtractedImage = {
  id: string
  dataUrl: string
  width: number
  height: number
}

type PdfImageObj = {
  width?: number
  height?: number
  kind?: number
  data?: Uint8ClampedArray | Uint8Array
  bitmap?: ImageBitmap
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x2000
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, Math.min(i + chunk, bytes.length))
    binary += String.fromCharCode.apply(
      null,
      sub as unknown as number[],
    )
  }
  return btoa(binary)
}

function isJpegBytes(data: Uint8Array): boolean {
  return data.length > 3 && data[0] === 0xff && data[1] === 0xd8
}

function imageObjToDataUrl(img: PdfImageObj): string | null {
  const w = img.width ?? 0
  const h = img.height ?? 0
  if (w < 40 || h < 40) return null
  if (w * h < 2500) return null

  if (img.bitmap) {
    const canvas = document.createElement('canvas')
    canvas.width = img.bitmap.width
    canvas.height = img.bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img.bitmap, 0, 0)
    return canvas.toDataURL('image/png')
  }

  if (!img.data || !w || !h) return null
  const bytes =
    img.data instanceof Uint8ClampedArray
      ? new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)
      : img.data

  if (isJpegBytes(bytes)) {
    return `data:image/jpeg;base64,${uint8ToBase64(bytes)}`
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const imageData = ctx.createImageData(w, h)
  const out = imageData.data
  const kind = img.kind ?? 2
  const src = img.data

  if (kind === 1) {
    for (let i = 0, j = 0; i < src.length && j < out.length; i += 1, j += 4) {
      const v = src[i]!
      out[j] = v
      out[j + 1] = v
      out[j + 2] = v
      out[j + 3] = 255
    }
  } else if (kind === 3) {
    out.set(src.subarray(0, Math.min(src.length, out.length)))
  } else {
    for (let i = 0, j = 0; i + 2 < src.length && j < out.length; i += 3, j += 4) {
      out[j] = src[i]!
      out[j + 1] = src[i + 1]!
      out[j + 2] = src[i + 2]!
      out[j + 3] = 255
    }
  }
  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}

function getObj(
  objs: { get: (name: string, callback?: (v: unknown) => void) => unknown },
  name: string,
): Promise<PdfImageObj | null> {
  return new Promise((resolve) => {
    try {
      const sync = objs.get(name) as PdfImageObj | undefined
      if (sync && (sync.data || sync.bitmap || sync.width)) {
        resolve(sync)
        return
      }
    } catch {
      /* async */
    }
    try {
      objs.get(name, (v) => resolve((v as PdfImageObj) || null))
      // timeout if never resolves
      window.setTimeout(() => resolve(null), 2500)
    } catch {
      resolve(null)
    }
  })
}

/** Sayfadaki gömülü görselleri çıkar (tam sayfa değil). */
export async function extractPageEmbeddedImages(
  src: string,
  pageNumber: number,
): Promise<ExtractedImage[]> {
  await ensurePdfWorker()
  const res = await fetch(src)
  if (!res.ok) throw new Error(`PDF alınamadı (${res.status})`)
  const data = new Uint8Array(await res.arrayBuffer())
  const doc = await pdfjsLib.getDocument({ data }).promise
  try {
    if (pageNumber < 1 || pageNumber > doc.numPages) return []
    const page = await doc.getPage(pageNumber)
    const ops = await page.getOperatorList()
    const paintOps = new Set([
      pdfjsLib.OPS.paintImageXObject,
      pdfjsLib.OPS.paintInlineImageXObject,
      // bazı PDF’ler form XObject kullanır; paintXObject ayrı ele alınır
    ])

    const names: string[] = []
    for (let i = 0; i < ops.fnArray.length; i += 1) {
      const fn = ops.fnArray[i]
      if (!paintOps.has(fn)) continue
      const args = ops.argsArray[i]
      const name = args?.[0]
      if (typeof name === 'string' && !names.includes(name)) names.push(name)
    }

    // Inline image ops sometimes pass image dict directly
    const out: ExtractedImage[] = []
    const seen = new Set<string>()

    for (const name of names) {
      const img =
        (await getObj(page.objs as never, name)) ||
        (await getObj(page.commonObjs as never, name))
      if (!img) continue
      const dataUrl = imageObjToDataUrl(img)
      if (!dataUrl) continue
      const key = `${img.width}x${img.height}:${dataUrl.slice(0, 64)}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        id: name,
        dataUrl,
        width: img.width || 0,
        height: img.height || 0,
      })
    }

    // Inline: paintInlineImageXObject args may be the image itself
    for (let i = 0; i < ops.fnArray.length; i += 1) {
      if (ops.fnArray[i] !== pdfjsLib.OPS.paintInlineImageXObject) continue
      const arg0 = ops.argsArray[i]?.[0] as PdfImageObj | undefined
      if (!arg0 || typeof arg0 === 'string') continue
      const dataUrl = imageObjToDataUrl(arg0)
      if (!dataUrl) continue
      const key = `inline:${arg0.width}x${arg0.height}:${dataUrl.slice(0, 64)}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        id: `inline-${i}`,
        dataUrl,
        width: arg0.width || 0,
        height: arg0.height || 0,
      })
    }

    // En büyük görseller önce (asıl figür)
    out.sort((a, b) => b.width * b.height - a.width * a.height)
    return out
  } finally {
    await doc.destroy().catch(() => undefined)
  }
}

/**
 * PDF sayfasındaki gömülü görselleri gösterir (tam sayfa kopyası değil).
 */
export default function PdfPagePreview({
  src,
  pageNumber,
  className = '',
}: Props) {
  const [images, setImages] = useState<ExtractedImage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (!src || pageNumber < 1) return

    void (async () => {
      setLoading(true)
      setError(null)
      setImages([])
      try {
        const list = await extractPageEmbeddedImages(src, pageNumber)
        if (cancelled) return
        setImages(list)
        if (!list.length) {
          setError(null) // sessiz: görsel çıkarılamadı
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Görsel yüklenemedi')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [src, pageNumber])

  if (loading) {
    return (
      <figure className={`pdf-page-preview ${className}`}>
        <p className="muted text-xs">Görsel yükleniyor…</p>
      </figure>
    )
  }

  if (error) {
    return (
      <figure className={`pdf-page-preview ${className}`}>
        <p className="muted text-xs">{error}</p>
      </figure>
    )
  }

  if (!images.length) return null

  return (
    <figure className={`pdf-page-preview ${className}`}>
      <div className="pdf-page-preview__stack">
        {images.map((img) => (
          <img
            key={img.id}
            src={img.dataUrl}
            alt=""
            className="pdf-page-preview__img"
            width={img.width || undefined}
            height={img.height || undefined}
          />
        ))}
      </div>
    </figure>
  )
}

/** Ham / formatlanmış metindeki görsel uyarılarını / işaretlerini ayıkla. */
export function stripImageNotices(text: string): {
  cleaned: string
  hadImageNotice: boolean
} {
  const raw = String(text || '')
  let had = /<!--\s*study:page-image\s*-->/i.test(raw)
  const cleaned = raw
    .replace(/<!--\s*study:page-image\s*-->/gi, () => {
      had = true
      return ''
    })
    .replace(
      /\*?\[?\*?Bu sayfada\s+\d+\s+görsel var[^\]]*\]?\*?\.?/gi,
      () => {
        had = true
        return ''
      },
    )
    .replace(
      /\*?\[?\*?Sayfa görsel ağırlıklı[^\]]*\]?\*?\.?/gi,
      () => {
        had = true
        return ''
      },
    )
    .replace(
      /\*?\[?[^\]]*orijinal PDF[’']de gör[^\]]*\]?\*?\.?/gi,
      () => {
        had = true
        return ''
      },
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { cleaned, hadImageNotice: had }
}
