import type { PdfOutlineItem } from '@/lib/pdfOutline'

type Props = {
  items: PdfOutlineItem[]
  currentPage: number
  onJump: (page: number) => void
  onClose?: () => void
}

/** Adobe-style bookmarks / içindekiler drawer. */
export default function PdfOutlinePanel({
  items,
  currentPage,
  onJump,
  onClose,
}: Props) {
  if (!items.length) {
    return (
      <aside className="pdf-outline" aria-label="İçindekiler">
        <header className="pdf-outline__head">
          <p className="pdf-outline__title">İçindekiler</p>
          {onClose ? (
            <button type="button" className="btn-ghost text-[11px]" onClick={onClose}>
              Kapat
            </button>
          ) : null}
        </header>
        <p className="muted p-3 text-xs leading-relaxed">
          Bu PDF’de yer imi / outline yok. Sayfa numarasıyla gezinebilirsin.
        </p>
      </aside>
    )
  }

  return (
    <aside className="pdf-outline" aria-label="İçindekiler">
      <header className="pdf-outline__head">
        <p className="pdf-outline__title">İçindekiler</p>
        {onClose ? (
          <button type="button" className="btn-ghost text-[11px]" onClick={onClose}>
            Kapat
          </button>
        ) : null}
      </header>
      <nav className="pdf-outline__nav">
        <OutlineList items={items} currentPage={currentPage} onJump={onJump} depth={0} />
      </nav>
    </aside>
  )
}

function OutlineList({
  items,
  currentPage,
  onJump,
  depth,
}: {
  items: PdfOutlineItem[]
  currentPage: number
  onJump: (page: number) => void
  depth: number
}) {
  return (
    <ul className="pdf-outline__list" style={{ paddingLeft: depth ? 0.75 : 0 }}>
      {items.map((item, i) => {
        const active =
          item.page != null &&
          item.page === currentPage
        return (
          <li key={`${item.title}-${item.page ?? 'x'}-${i}`}>
            <button
              type="button"
              className={`pdf-outline__item${active ? ' is-active' : ''}`}
              disabled={item.page == null}
              onClick={() => item.page != null && onJump(item.page)}
              title={item.page != null ? `Sayfa ${item.page}` : undefined}
            >
              <span className="pdf-outline__item-title">{item.title}</span>
              {item.page != null ? (
                <span className="pdf-outline__item-page">{item.page}</span>
              ) : null}
            </button>
            {item.items.length > 0 ? (
              <OutlineList
                items={item.items}
                currentPage={currentPage}
                onJump={onJump}
                depth={depth + 1}
              />
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
