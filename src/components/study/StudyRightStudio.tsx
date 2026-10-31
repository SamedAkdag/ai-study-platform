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
  /** Override default icon keyed by id */
  icon?: StudioIconName
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

export type StudioIconName =
  | 'tools'
  | 'pin'
  | 'narrate'
  | 'map'
  | 'guide'
  | 'audio'
  | 'flash'
  | 'download'
  | 'pdf'
  | 'add'
  | 'chat'
  | 'settings'
  | 'token'
  | 'generic'

function StudioIcon({
  name,
  className = '',
}: {
  name: StudioIconName
  className?: string
}) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
    className: `studio-rail__icon-svg ${className}`.trim(),
  }

  switch (name) {
    case 'tools':
      return (
        <svg {...common}>
          <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.1 2.1-1.8-1.8 2.1-2.1Z" />
        </svg>
      )
    case 'pin':
      return (
        <svg {...common}>
          <path d="M12 17v5" />
          <path d="M9 3h6l1 7-4 3-4-3 1-7Z" />
          <path d="M8 10h8" />
        </svg>
      )
    case 'narrate':
      return (
        <svg {...common}>
          <path d="M4 5h16v11H8l-4 3V5Z" />
          <path d="M8 9h8M8 12h5" />
        </svg>
      )
    case 'map':
      /* Zihin haritası: merkez + dallanan düğümler */
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
          <circle cx="12" cy="4.2" r="1.7" />
          <circle cx="19.2" cy="10.2" r="1.7" />
          <circle cx="16.8" cy="18.5" r="1.7" />
          <circle cx="7.2" cy="18.5" r="1.7" />
          <circle cx="4.8" cy="10.2" r="1.7" />
          <path d="M12 9.4V6.2M14.3 13.1l3.2-1.5M13.4 14.2l2.2 2.8M10.6 14.2 8.4 17M9.7 13.1 6.5 11.6" />
        </svg>
      )
    case 'guide':
      return (
        <svg {...common}>
          <path d="M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 0-3 3V4Z" />
          <path d="M17 4v16a3 3 0 0 1-3 0" />
          <path d="M8 8h5M8 11h4" />
        </svg>
      )
    case 'audio':
      /* Podcast: kulaklık */
      return (
        <svg {...common}>
          <path d="M4.5 13.5v2a2 2 0 0 0 2 2H8" />
          <path d="M19.5 13.5v2a2 2 0 0 1-2 2H16" />
          <path d="M4.5 13.5A7.5 7.5 0 0 1 12 6a7.5 7.5 0 0 1 7.5 7.5" />
          <rect x="3" y="12" width="4" height="6.5" rx="1.4" />
          <rect x="17" y="12" width="4" height="6.5" rx="1.4" />
        </svg>
      )
    case 'flash':
      return (
        <svg {...common}>
          <path d="M13 2 4 14h7l-1 8 10-14h-7l1-6Z" />
        </svg>
      )
    case 'download':
      return (
        <svg {...common}>
          <path d="M12 3v11" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 19h14" />
        </svg>
      )
    case 'pdf':
      return (
        <svg {...common}>
          <path d="M7 3h7l5 5v13H7V3Z" />
          <path d="M14 3v5h5" />
          <path d="M9 14h6M9 17h4" />
        </svg>
      )
    case 'add':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      )
    case 'chat':
      return (
        <svg {...common}>
          <path d="M5 5h14v10H9l-4 3V5Z" />
          <path d="M8 9h8M8 12h5" />
        </svg>
      )
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3.5v2.2M12 18.3v2.2M4.9 7.1l1.6 1.5M17.5 15.4l1.6 1.5M3.5 12h2.2M18.3 12h2.2M4.9 16.9l1.6-1.5M17.5 8.6l1.6-1.5" />
        </svg>
      )
    case 'token':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7v10M9 9.5c.8-1 2-1.5 3-1.5s2.2.5 3 1.5M9 14.5c.8 1 2 1.5 3 1.5s2.2-.5 3-1.5" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
      )
  }
}

function iconForToolId(id: string): StudioIconName {
  if (id === 'flash') return 'flash'
  if (id === 'export') return 'download'
  if (id === 'full-pdf') return 'pdf'
  if (id === 'contribute') return 'add'
  if (id === 'together') return 'chat'
  if (id === 'settings') return 'settings'
  if (id === 'usage') return 'token'
  return 'generic'
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
    {
      id: 'map',
      label: 'Zihin haritası',
      title: 'Konuyu dallarla gör',
      hidden: !hasMap,
    },
    { id: 'guide', label: 'Kılavuz', title: 'Çalışma kılavuzu' },
    {
      id: 'audio',
      label: 'Dinle',
      title: 'Podcast veya tam hoca dersi',
    },
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
        <span className="studio-rail__peek-ico" aria-hidden>
          <StudioIcon name="tools" />
        </span>
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
              <p className="studio-rail__heading">Stüdyo</p>
              <p className="studio-rail__sub muted text-xs">
                Anlatım ve yardımcı araçlar
              </p>
            </div>
            <button
              type="button"
              className={`studio-rail__pin${pinned ? ' is-on' : ''}`}
              onClick={() => setPinned((v) => !v)}
              aria-pressed={pinned}
              title={pinned ? 'Sabiti kaldır' : 'Paneli sabitle'}
            >
              <StudioIcon name="pin" />
              <span>{pinned ? 'Sabit' : 'Sabitle'}</span>
            </button>
          </div>

          {visibleStudio.length > 0 && onChange ? (
            <section className="studio-rail__section" aria-label="Stüdyo">
              <p className="studio-rail__section-label">Öğren</p>
              <div
                className="studio-rail__grid"
                role="tablist"
                aria-label="Stüdyo"
              >
                <button
                  type="button"
                  role="tab"
                  className={`studio-rail__tile ${active === null ? 'is-active' : ''}`}
                  aria-selected={active === null}
                  title="Konu anlatımı"
                  onClick={() => onChange(null)}
                >
                  <span className="studio-rail__tile-ico">
                    <StudioIcon name="narrate" />
                  </span>
                  <span className="studio-rail__tile-label">Anlatım</span>
                </button>
                {visibleStudio.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    className={`studio-rail__tile ${active === t.id ? 'is-active' : ''}`}
                    aria-selected={active === t.id}
                    title={t.title}
                    onClick={() => onChange(active === t.id ? null : t.id)}
                  >
                    <span className="studio-rail__tile-ico">
                      <StudioIcon
                        name={
                          t.id === 'map'
                            ? 'map'
                            : t.id === 'guide'
                              ? 'guide'
                              : 'audio'
                        }
                      />
                    </span>
                    <span className="studio-rail__tile-label">{t.label}</span>
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
                  const icon = item.icon || iconForToolId(item.id)
                  const className = `studio-rail__btn ${item.active ? 'is-active' : ''}`
                  const body = (
                    <>
                      <span className="studio-rail__btn-ico" aria-hidden>
                        <StudioIcon name={icon} />
                      </span>
                      <span className="studio-rail__label">{item.label}</span>
                    </>
                  )
                  if (item.href) {
                    return (
                      <Link
                        key={item.id}
                        to={item.href}
                        className={className}
                        title={item.title || item.label}
                      >
                        {body}
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
                      {body}
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
