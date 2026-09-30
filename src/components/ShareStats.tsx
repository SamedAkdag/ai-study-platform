type Props = {
  viewCount?: number | null
  shareCount?: number | null
  className?: string
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

/** Compact “X okuma · Y paylaşım” line for book headers. */
export default function ShareStats({
  viewCount = 0,
  shareCount = 0,
  className = '',
}: Props) {
  const views = Math.max(0, viewCount ?? 0)
  const shares = Math.max(0, shareCount ?? 0)
  return (
    <p
      className={`share-stats ${className}`.trim()}
      title={`${views} okuma · ${shares} paylaşım`}
    >
      <span>{formatCount(views)} okuma</span>
      <span className="share-stats__dot" aria-hidden>
        ·
      </span>
      <span>{formatCount(shares)} paylaşım</span>
    </p>
  )
}
