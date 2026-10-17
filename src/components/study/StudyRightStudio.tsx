import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

export type ReadStudioTab = 'map' | 'guide' | 'audio'

export type StudioToolItem = {
  id: string
  label: string
  title?: string
  onClick?: () => void
  href?: string
  active?: boolean
  hidden?: boolean
}

type StudioTab = {
  id: ReadStudioTab
  label: string
  title: string
  hidden?: boolean
}

type Props = {
  /** Studio tools (Anlatım / Harita / …) — only when reading */
  showStudio?: boolean
  active?: ReadStudioTab | null
  onChange?: (tab: ReadStudioTab | null) => void
  hasMap?: boolean
  /** Shared utilities: Flash, İndir, PDF, … */
  tools?: StudioToolItem[]
  panel?: ReactNode
  panelOpen?: boolean
  panelTitle?: string
  panelWide?: boolean
  onClosePanel?: () => void
}

/**
 * Right peek “Araçlar”: studio tabs + download/flash/etc in one flyout.
 */
export default function StudyRightStudio({
  showStudio = false,
  active = null,
  onChange,
  hasMap = true,
  tools = [],
  panel,
  panelOpen,
  panelTitle = 'Panel',
  panelWide,
  onClosePanel,
}: Props) {
  const [pinned, setPinned] = useState(false)

  const studioTabs: StudioTab[] = [
    { id: 'map', label: 'Harita', title: 'Konu haritası', hidden: !hasMap },
    { id: 'guide', label: 'Kılavuz', title: 'Çalışma kılavuzu' },
    { id: 'audio', label: 'Ses', title: 'Sesli özet' },
  ]
  const visibleStudio = showStudio
    ? studioTabs.filter((t) => !t.hidden)
    : []
  const visibleTools = tools.filter((t) => !t.hidden)

  if (visibleStudio.length === 0 && visibleTools.length === 0 && !panelOpen) {
    return null
  }

  return (
    <aside
      className={`studio-rail ${pinned ? 'is-open' : ''}`}
      aria-label="Çalışma araçları"
    >
      <div className="studio-rail__hit" aria-hidden />

      <button
        type="button"
        className="studio-rail__peek"
        title="Araçlar"
        aria-expanded={pinned}
        aria-controls="studio-rail-flyout"
        onClick={() => setPinned((v) => !v)}
      >
        <span className="studio-rail__grip" aria-hidden />
        <span className="studio-rail__peek-label">Araçlar</span>
      </button>

      {panelOpen && panel ? (
        <div
          className={`studio-rail__panel ${panelWide ? 'studio-rail__panel--wide' : ''}`}
        >
          <div className="studio-rail__panel-head">
            <p className="section-label mb-0">{panelTitle}</p>
            <button
              type="button"
              className="btn-ghost text-[11px]"
              onClick={onClosePanel}
            >
              Kapat
            </button>
          </div>
          <div className="studio-rail__panel-body">{panel}</div>
        </div>
      ) : null}

      <div className="studio-rail__sheet" id="studio-rail-flyout">
        <div className="studio-rail__flyout">
          <div className="studio-rail__head">
            <div className="min-w-0">
              <p className="studio-rail__heading">Araçlar</p>
              <p className="studio-rail__sub muted text-xs">
                Stüdyo, indir, flash
              </p>
            </div>
            <button
              type="button"
              className="btn-ghost text-[11px] shrink-0"
              onClick={() => setPinned((v) => !v)}
              aria-pressed={pinned}
            >
              {pinned ? 'Sabit' : 'Sabitle'}
            </button>
          </div>

          {visibleStudio.length > 0 && onChange ? (
            <section className="studio-rail__section" aria-label="Stüdyo">
              <p className="studio-rail__section-label">Stüdyo</p>
              <div
                className="studio-rail__stack"
                role="tablist"
                aria-label="Stüdyo"
              >
                <button
                  type="button"
                  role="tab"
                  className={`studio-rail__btn ${active === null ? 'is-active' : ''}`}
                  aria-selected={active === null}
                  title="Konu anlatımı"
                  onClick={() => onChange(null)}
                >
                  <span className="studio-rail__label">Anlatım</span>
                </button>
                {visibleStudio.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    className={`studio-rail__btn ${active === t.id ? 'is-active' : ''}`}
                    aria-selected={active === t.id}
                    title={t.title}
                    onClick={() => onChange(active === t.id ? null : t.id)}
                  >
                    <span className="studio-rail__label">{t.label}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {visibleTools.length > 0 ? (
            <section className="studio-rail__section" aria-label="İşlemler">
              <p className="studio-rail__section-label">İşlemler</p>
              <div className="studio-rail__stack" role="toolbar">
                {visibleTools.map((item) => {
                  const className = `studio-rail__btn ${item.active ? 'is-active' : ''}`
                  if (item.href) {
                    return (
                      <Link
                        key={item.id}
                        to={item.href}
                        className={className}
                        title={item.title || item.label}
                      >
                        <span className="studio-rail__label">{item.label}</span>
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
                      <span className="studio-rail__label">{item.label}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </aside>
  )
}
