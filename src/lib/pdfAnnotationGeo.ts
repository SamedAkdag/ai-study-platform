import type { PdfRegion } from '@/lib/pdfRegion'
import type { PdfSelectionPayload } from '@/types/pdfSelection'

/** Stable page geometry from a selection payload (region + insert anchors). */
export function geoFromPayload(payload: PdfSelectionPayload): {
  region?: PdfRegion
  regions?: PdfRegion[]
  anchorTopPct?: number
  anchorLeftPct?: number
} {
  const regions =
    payload.regions && payload.regions.length > 0
      ? payload.regions
      : payload.region
        ? [payload.region]
        : undefined
  const region = regions?.[0] ?? payload.region
  if (!region) return {}
  const last = regions?.[regions.length - 1] ?? region
  return {
    region,
    regions,
    anchorTopPct: Math.min(0.98, last.topPct + last.heightPct),
    anchorLeftPct: region.leftPct,
  }
}
