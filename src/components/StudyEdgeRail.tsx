import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export type EdgeRailItem = {
  id: string
  label: string
  title?: string
  onClick?: () => void
  href?: string
  active?: boolean
  hidden?: boolean
}

export type EdgeRailGroup = {
  id: string
  label?: string
  items: EdgeRailItem[]
}

type Props = {
  /** Flat list (legacy) — wrapped as one group */
  items?: EdgeRailItem[]
  /** Preferred: labelled groups on the rail */
  groups?: EdgeRailGroup[]
  panel?: ReactNode
  panelOpen?: boolean
  panelTitle?: string
  panelWide?: boolean
  onClosePanel?: () => void
}

/**
 * Fixed right-edge tool rail with optional grouped actions + side panel.
 */
export default function StudyEdgeRail({
  items,
  groups: groupsProp,
  panel,
  panelOpen,
  panelTitle = 'Panel',
  panelWide,
  onClosePanel,
}: Props) {
  const groups: EdgeRailGroup[] =
    groupsProp ??
    (items?.length
      ? [{ id: 'main', items }]
      : [])

  const visibleGroups = groups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !i.hidden),
    }))
    .filter((g) => g.items.length > 0)

  if (visibleGroups.length === 0 && !panelOpen) return null

  return (
    <aside className="edge-rail" aria-label="Araçlar">
      {panelOpen && panel ? (
        <div
          className={`edge-rail__panel ${panelWide ? 'edge-rail__panel--wide' : ''}`}
        >
          <div className="edge-rail__panel-head">
            <p className="section-label mb-0">{panelTitle}</p>
            <button
              type="button"
              className="btn-ghost text-[11px]"
              onClick={onClosePanel}
            >
              Kapat
            </button>
          </div>
          <div className="edge-rail__panel-body">{panel}</div>
        </div>
      ) : null}

      <div className="edge-rail__stack" role="toolbar">
        {visibleGroups.map((g, gi) => (
          <div key={g.id} className="edge-rail__group">
            {g.label ? (
              <p className="edge-rail__group-label">{g.label}</p>
            ) : gi > 0 ? (
              <span className="edge-rail__divider" aria-hidden />
            ) : null}
            {g.items.map((item) => {
              const className = `edge-rail__btn ${item.active ? 'is-active' : ''}`
              if (item.href) {
                return (
                  <Link
                    key={item.id}
                    to={item.href}
                    className={className}
                    title={item.title || item.label}
                  >
                    <span className="edge-rail__label">{item.label}</span>
                  </Link>
                )
              }
              return (
                <button
                  key={item.id}
                  type="button"
                  className={className}
                  title={item.title || item.label}
                  aria-pressed={item.active || undefined}
                  onClick={item.onClick}
                >
                  <span className="edge-rail__label">{item.label}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </aside>
  )
}
