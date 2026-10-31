import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeMouseHandler,
  type ReactFlowInstance,
  Handle,
  Position,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { MindMapData, PageSource } from '@/types/database'
import {
  buildMindMapTopicDetail,
  type MindMapTopicDetail,
} from '@/lib/mindMapTopicDetail'
import {
  locateMindMapInPdf,
  type MindMapPdfHit,
} from '@/lib/mindMapPdfLocate'
import { normalizeMindMapTopics, toTopicLabel } from '@/lib/mindMapTopics'
import {
  getStoredLang,
  getStoredRate,
  getStoredVoiceUri,
  isTtsSupported,
  speakText,
  stopSpeech,
} from '@/lib/tts'
import StudyMarkdown from '@/components/StudyMarkdown'

type Props = {
  data: MindMapData
  title?: string
  markdown?: string | null
  defaultCollapsed?: boolean
  pageSources?: PageSource[] | null
  pageText?: string | null
  startPage?: number | null
  endPage?: number | null
  onOpenInPdf?: (page: number, label: string) => void
  onRefreshMap?: () => void
  refreshingMap?: boolean
}

const BRANCH_COLORS_FALLBACK = [
  '#2d4635',
  '#3d6b8a',
  '#a67c52',
  '#3d5c48',
  '#5a6d7c',
  '#6fa98a',
]

function readBranchColors(): string[] {
  if (typeof document === 'undefined') return BRANCH_COLORS_FALLBACK
  const cs = getComputedStyle(document.documentElement)
  const pick = (name: string, fb: string) => {
    const v = cs.getPropertyValue(name).trim()
    return v || fb
  }
  return [
    pick('--accent-mid', BRANCH_COLORS_FALLBACK[0]!),
    pick('--accent', BRANCH_COLORS_FALLBACK[1]!),
    pick('--gold', BRANCH_COLORS_FALLBACK[2]!),
    pick('--accent-deep', BRANCH_COLORS_FALLBACK[3]!),
    pick('--ink-muted', BRANCH_COLORS_FALLBACK[4]!),
    pick('--accent-mid', BRANCH_COLORS_FALLBACK[5]!),
  ]
}

type NodeData = {
  label: string
  kind: 'central' | 'branch' | 'leaf'
  color?: string
  children?: string[]
  page?: number | null
  /** Branch id for expand toggle */
  branchId?: string
  childCount?: number
  isOpen?: boolean
}

function ConceptNode({ data }: NodeProps) {
  const d = data as NodeData
  const kind = String(d.kind || 'branch')
  const label = String(d.label || '')
  const color = String(d.color || '')
  const childCount = Number(d.childCount || 0)
  const isOpen = Boolean(d.isOpen)
  return (
    <div
      className={`mind-node mind-node--${kind}${isOpen ? ' mind-node--open' : ''}${
        childCount > 0 && kind === 'branch' ? ' mind-node--expandable' : ''
      }`}
      style={
        kind === 'branch' && color
          ? {
              borderColor: `${color}55`,
              background: `${color}12`,
              color,
            }
          : kind === 'leaf' && color
            ? { borderColor: `${color}28` }
            : undefined
      }
    >
      {kind !== 'central' && (
        <Handle type="target" position={Position.Left} className="!opacity-0" />
      )}
      <span className="mind-node__label">{label}</span>
      {kind === 'branch' && childCount > 0 ? (
        <span className="mind-node__badge" aria-hidden>
          {isOpen ? '−' : `+${childCount}`}
        </span>
      ) : null}
      {kind !== 'leaf' && (
        <Handle type="source" position={Position.Right} className="!opacity-0" />
      )}
    </div>
  )
}

const nodeTypes = { concept: ConceptNode }

type Branch = { label: string; children?: string[]; page?: number | null }

function estimateHeight(label: string, kind: 'central' | 'branch' | 'leaf'): number {
  const charsPerLine = kind === 'leaf' ? 24 : kind === 'branch' ? 22 : 18
  const lines = Math.max(
    1,
    Math.ceil(label.replace(/\s+/g, ' ').trim().length / charsPerLine),
  )
  const lineH = kind === 'central' ? 22 : 17
  const pad = kind === 'leaf' ? 22 : 26
  const maxLines = kind === 'leaf' ? 3 : 2
  return pad + Math.min(lines, maxLines) * lineH
}

function tidyBranches(raw: Branch[]): Branch[] {
  const normalized = normalizeMindMapTopics({
    central: '·',
    branches: raw.map((b) => ({
      label: b.label,
      children: b.children,
      page: b.page,
    })),
  })
  return normalized.branches.map((b) => ({
    label: b.label,
    children: b.children,
    page: b.page ?? null,
  }))
}

/**
 * NotebookLM-style: only expanded branches reveal children.
 * Default view = merkez + ana dallar.
 */
function layoutMindMap(
  data: MindMapData,
  openIds: Set<string>,
): { nodes: Node[]; edges: Edge[]; focusIds: string[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const focusIds: string[] = []
  const branches = tidyBranches(data.branches ?? [])

  const COL = { central: 28, branch: 280, leaf: 520 }
  const BRANCH_GAP = 26
  const LEAF_GAP = 12
  const colors = readBranchColors()
  const centralLabel =
    toTopicLabel(String(data.central || 'Konu'), {
      maxWords: 5,
      maxChars: 36,
    }) || 'Konu'

  const laid = branches.map((b, i) => {
    const bid = `b-${i}`
    const open = openIds.has(bid)
    const kids = open ? (b.children ?? []).slice(0, 8) : []
    const leafHs = kids.map((c) => estimateHeight(c, 'leaf'))
    const leavesH =
      leafHs.reduce((s, h) => s + h, 0) +
      Math.max(0, leafHs.length - 1) * LEAF_GAP
    const branchH = estimateHeight(b.label, 'branch')
    return {
      bid,
      label: b.label,
      h: Math.max(branchH, leavesH || branchH),
      branchH,
      children: kids,
      leafHs,
      page: b.page ?? null,
      allChildren: b.children ?? [],
      open,
      color: colors[i % colors.length]!,
    }
  })

  const totalH =
    laid.reduce((s, b) => s + b.h, 0) + Math.max(0, laid.length - 1) * BRANCH_GAP

  const startY = 16
  const centralH = estimateHeight(centralLabel, 'central')

  nodes.push({
    id: 'central',
    type: 'concept',
    position: {
      x: COL.central,
      y: startY + Math.max(0, totalH / 2 - centralH / 2),
    },
    data: {
      label: centralLabel,
      kind: 'central',
      children: branches.map((b) => b.label),
    } satisfies NodeData,
    draggable: false,
  })

  let cursorY = startY
  laid.forEach((branch) => {
    const branchY = cursorY + Math.max(0, (branch.h - branch.branchH) / 2)

    nodes.push({
      id: branch.bid,
      type: 'concept',
      position: { x: COL.branch, y: branchY },
      data: {
        label: branch.label,
        kind: 'branch',
        color: branch.color,
        children: branch.allChildren,
        page: branch.page,
        branchId: branch.bid,
        childCount: branch.allChildren.length,
        isOpen: branch.open,
      } satisfies NodeData,
      draggable: false,
    })

    edges.push({
      id: `e-c-${branch.bid}`,
      source: 'central',
      target: branch.bid,
      type: 'smoothstep',
      animated: branch.open,
      style: {
        stroke: branch.color,
        strokeWidth: branch.open ? 2.4 : 1.7,
        opacity: branch.open ? 0.95 : 0.55,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 14,
        height: 14,
        color: branch.color,
      },
    })

    if (branch.open) {
      focusIds.push(branch.bid)
      let leafY = cursorY
      branch.children.forEach((child, j) => {
        const lid = `${branch.bid}-l-${j}`
        const lh = branch.leafHs[j] ?? estimateHeight(child, 'leaf')
        nodes.push({
          id: lid,
          type: 'concept',
          position: { x: COL.leaf, y: leafY },
          data: {
            label: child,
            kind: 'leaf',
            color: branch.color,
            page: branch.page,
            branchId: branch.bid,
          } satisfies NodeData,
          draggable: false,
        })
        edges.push({
          id: `e-${branch.bid}-${j}`,
          source: branch.bid,
          target: lid,
          type: 'smoothstep',
          animated: true,
          style: {
            stroke: branch.color,
            strokeWidth: 1.45,
            opacity: 0.72,
          },
        })
        focusIds.push(lid)
        leafY += lh + LEAF_GAP
      })
    }

    cursorY += branch.h + BRANCH_GAP
  })

  return { nodes, edges, focusIds }
}

const KIND_LABEL: Record<string, string> = {
  central: 'Merkez',
  branch: 'Ana başlık',
  leaf: 'Alt başlık',
}

function useCoarsePointer() {
  const [coarse, setCoarse] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse), (max-width: 767px)')
    const apply = () => setCoarse(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  return coarse
}

function fitCalm(
  rf: ReactFlowInstance | null,
  opts?: { animate?: boolean; coarse?: boolean; nodeIds?: string[] },
) {
  if (!rf) return
  const animate = opts?.animate ?? false
  const coarse = opts?.coarse ?? false
  const nodeIds = opts?.nodeIds
  void rf.fitView({
    ...(nodeIds?.length ? { nodes: nodeIds.map((id) => ({ id })) } : {}),
    padding: nodeIds?.length ? (coarse ? 0.28 : 0.22) : coarse ? 0.1 : 0.08,
    includeHiddenNodes: false,
    minZoom: nodeIds?.length ? 0.7 : 0.55,
    maxZoom: nodeIds?.length ? 1.35 : 1.2,
    duration: animate ? 320 : 0,
  })
}

/** Interactive topic map — expand children on click + zoom (NotebookLM-style). */
export default function MindMapPanel({
  data,
  title,
  markdown,
  defaultCollapsed = false,
  pageSources = null,
  pageText = null,
  startPage = null,
  endPage = null,
  onOpenInPdf,
  onRefreshMap,
  refreshingMap = false,
}: Props) {
  const branches = useMemo(
    () => tidyBranches(data.branches ?? []),
    [data.branches],
  )
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set())
  const [detail, setDetail] = useState<MindMapTopicDetail | null>(null)
  const [pdfHit, setPdfHit] = useState<MindMapPdfHit | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const rfRef = useRef<ReactFlowInstance | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const detailRef = useRef<HTMLElement | null>(null)
  const pendingFocusRef = useRef<string[] | null>(null)
  const coarse = useCoarsePointer()
  const branchColors = useMemo(() => readBranchColors(), [data.central, data.branches])

  const { nodes, edges, focusIds } = useMemo(
    () => layoutMindMap(data, openIds),
    [data, openIds],
  )

  const topicCount = useMemo(() => {
    let n = 1 + branches.length
    for (const b of branches) n += b.children?.length ?? 0
    return n
  }, [branches])

  const openCount = openIds.size
  const childCountOpen = useMemo(() => {
    let n = 0
    openIds.forEach((id) => {
      const i = Number(id.replace('b-', ''))
      if (Number.isFinite(i) && branches[i]) n += branches[i]!.children?.length ?? 0
    })
    return n
  }, [openIds, branches])

  const canLocatePdf = Boolean(onOpenInPdf)

  const findPdfHit = useCallback(
    (label: string, page?: number | null) => {
      if (!canLocatePdf) return null
      return locateMindMapInPdf({
        label,
        page,
        pageSources,
        pageText,
        startPage,
        endPage,
      })
    },
    [canLocatePdf, pageSources, pageText, startPage, endPage],
  )

  const scheduleFit = useCallback(
    (animate = false, nodeIds?: string[]) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          fitCalm(rfRef.current, { animate, coarse, nodeIds })
        })
      })
    },
    [coarse],
  )

  // Reset drill-down when map data regenerates
  useEffect(() => {
    setOpenIds(new Set())
    setDetail(null)
    setPdfHit(null)
    pendingFocusRef.current = null
  }, [data.central, data.branches])

  useEffect(() => {
    if (collapsed) return
    const focus = pendingFocusRef.current
    if (focus?.length) {
      pendingFocusRef.current = null
      scheduleFit(true, focus)
      return
    }
    if (openIds.size === 0) scheduleFit(false)
  }, [collapsed, nodes, edges, expanded, openIds, scheduleFit, focusIds])

  useEffect(() => {
    if (collapsed || !canvasRef.current) return
    const el = canvasRef.current
    const ro = new ResizeObserver(() => {
      if (openIds.size > 0 && focusIds.length) scheduleFit(false, focusIds)
      else scheduleFit(false)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [collapsed, expanded, scheduleFit, openIds, focusIds])

  useEffect(() => {
    if (!expanded) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [expanded])

  useEffect(() => {
    if (!detail || expanded || coarse) return
    detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [detail, expanded, coarse])

  const openDetail = useCallback(
    (d: NodeData) => {
      stopSpeech()
      setSpeaking(false)
      setDetail(
        buildMindMapTopicDetail({
          label: d.label,
          kind: d.kind || 'branch',
          children: d.children,
          markdown,
          unitTitle: title,
        }),
      )
      setPdfHit(findPdfHit(d.label, d.page))
    },
    [markdown, title, findPdfHit],
  )

  const toggleBranch = useCallback(
    (branchId: string, d: NodeData) => {
      setOpenIds((prev) => {
        const next = new Set<string>()
        // Accordion: one branch open at a time keeps the map readable
        if (!prev.has(branchId)) next.add(branchId)
        const willOpen = next.has(branchId)
        if (willOpen) {
          const kids = (d.children ?? []).slice(0, 6)
          pendingFocusRef.current = [
            branchId,
            ...kids.map((_, j) => `${branchId}-l-${j}`),
          ]
        } else {
          pendingFocusRef.current = ['central', ...branches.map((_, i) => `b-${i}`)]
        }
        return next
      })
      openDetail(d)
    },
    [branches, openDetail],
  )

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_ev, node) => {
      const d = node.data as NodeData
      if (d.kind === 'branch' && (d.childCount ?? 0) > 0 && d.branchId) {
        toggleBranch(d.branchId, d)
        return
      }
      if (d.kind === 'central') {
        setOpenIds(new Set())
        pendingFocusRef.current = [
          'central',
          ...branches.map((_, i) => `b-${i}`),
        ]
        openDetail(d)
        return
      }
      openDetail(d)
    },
    [toggleBranch, openDetail, branches],
  )

  function speakDetail() {
    if (!detail || !isTtsSupported()) return
    speakText(detail.speech, {
      rate: getStoredRate(),
      voiceUri: getStoredVoiceUri(),
      lang: getStoredLang(),
      onStatus: (s) => setSpeaking(s === 'speaking' || s === 'paused'),
      onEnd: () => setSpeaking(false),
    })
  }

  function closeDetail() {
    stopSpeech()
    setSpeaking(false)
    setDetail(null)
    setPdfHit(null)
  }

  function openInPdf() {
    if (!detail || !pdfHit || !onOpenInPdf) return
    onOpenInPdf(pdfHit.page, detail.title)
  }

  function resetOverview() {
    setOpenIds(new Set())
    pendingFocusRef.current = [
      'central',
      ...branches.map((_, i) => `b-${i}`),
    ]
    scheduleFit(true)
  }

  if (!branches.length) return null

  const canvas = (
    <div
      ref={canvasRef}
      className={`mind-map-canvas ${expanded ? 'mind-map-canvas--expanded' : ''}`}
    >
      <div className="mind-map-canvas__aurora" aria-hidden />
      <div className="mind-map-canvas__grid" aria-hidden />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={(instance) => {
          rfRef.current = instance
          scheduleFit(false)
        }}
        minZoom={0.35}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        panOnScroll={!coarse}
        zoomOnScroll={!coarse}
        zoomOnPinch
        zoomOnDoubleClick={false}
        panOnDrag
        preventScrolling
        onNodeClick={onNodeClick}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        attributionPosition="bottom-left"
      >
        <Background
          id="mind-dots"
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.15}
          color={`${branchColors[0] || '#3d5c48'}44`}
        />
        <Background
          id="mind-lines"
          variant={BackgroundVariant.Lines}
          gap={88}
          size={1}
          color={`${branchColors[0] || '#3d5c48'}22`}
        />
        <MiniMap
          className="mind-map-minimap"
          pannable
          zoomable
          nodeStrokeWidth={2}
          maskColor="rgba(18, 24, 32, 0.18)"
          nodeColor={(n) => {
            const d = n.data as NodeData
            if (d.kind === 'central') return branchColors[3] || branchColors[0] || '#243a2c'
            return String(d.color || branchColors[0] || '#3d5c48')
          }}
        />
        <Controls showInteractive={false} showFitView={false} />
      </ReactFlow>
      <div className="mind-map-hud" aria-hidden>
        <span>{topicCount} düğüm</span>
        <span>·</span>
        <span>{branches.length} dal</span>
        {openCount > 0 ? (
          <>
            <span>·</span>
            <span className="mind-map-hud__live">
              {openCount} açık · {childCountOpen} alt
            </span>
          </>
        ) : (
          <>
            <span>·</span>
            <span>genel bakış</span>
          </>
        )}
      </div>
    </div>
  )

  const detailCard = detail ? (
    <aside
      ref={detailRef}
      className={`mind-map-detail mind-map-detail--glass ${
        coarse ? 'mind-map-detail--sheet' : 'mind-map-detail--dock'
      }`}
      aria-live="polite"
    >
      {coarse ? <div className="mind-map-detail__grab" aria-hidden /> : null}
      <div className="mind-map-detail__top">
        <div>
          <p className="mind-map-detail__kind">
            {KIND_LABEL[detail.kind] || 'Konu'}
          </p>
          <h3 className="mind-map-detail__title">{detail.title}</h3>
        </div>
        <div className="mind-map-detail__actions">
          {isTtsSupported() ? (
            speaking ? (
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  stopSpeech()
                  setSpeaking(false)
                }}
              >
                Durdur
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary !px-3 !py-1.5 text-xs"
                onClick={speakDetail}
              >
                Sesli oku
              </button>
            )
          ) : null}
          <button type="button" className="btn-ghost text-xs" onClick={closeDetail}>
            Kapat
          </button>
        </div>
      </div>

      {pdfHit && onOpenInPdf ? (
        <button
          type="button"
          className="mind-map-detail__pdf"
          onClick={openInPdf}
        >
          PDF’de aç · s. {pdfHit.page}
        </button>
      ) : canLocatePdf ? (
        <p className="mind-map-detail__pdf-miss muted text-xs">
          Bu düğüm için PDF sayfası bulunamadı
        </p>
      ) : null}

      <div className="mind-map-detail__body">
        <StudyMarkdown markdown={detail.narrative} compact />
      </div>

      {detail.points.length > 0 && (
        <div className="mind-map-detail__points">
          <p className="mind-map-detail__points-label">Alt başlıklar</p>
          <ul>
            {detail.points.map((pt) => (
              <li key={pt}>{pt}</li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  ) : null

  const panel = (
    <div
      className={`mind-map-panel mind-map-panel--spectacle ${
        expanded ? 'mind-map-panel--expanded' : ''
      }${detail && !coarse ? ' mind-map-panel--with-detail' : ''}`}
    >
      <div className="mind-map-panel__head">
        <div>
          <p className="mind-map-panel__kicker">Konu ağı</p>
          <h2 className="mind-map-panel__title">
            {title?.trim() || String(data.central || 'Zihin haritası')}
          </h2>
          {!collapsed && (
            <p className="mind-map-panel__sub">
              {coarse
                ? 'Düğüme dokun — alt başlıklar açılır, PDF’ye sıçra'
                : 'Dalı genişlet · scroll ile zoom · detay paneli sağda'}
            </p>
          )}
        </div>
        <div className="mind-map-panel__tools">
          {onRefreshMap ? (
            <button
              type="button"
              className="mind-map-tool"
              disabled={refreshingMap}
              onClick={() => onRefreshMap()}
            >
              {refreshingMap ? 'Yenileniyor…' : 'Yenile'}
            </button>
          ) : null}
          <button
            type="button"
            className="mind-map-tool"
            onClick={() => {
              const next = !collapsed
              setCollapsed(next)
              if (!next) scheduleFit(false)
            }}
          >
            {collapsed ? 'Göster' : 'Gizle'}
          </button>
          {!collapsed && (
            <>
              <button
                type="button"
                className="mind-map-tool"
                onClick={resetOverview}
              >
                Genel bakış
              </button>
              <button
                type="button"
                className="mind-map-tool mind-map-tool--accent"
                onClick={() => {
                  setExpanded((v) => !v)
                }}
              >
                {expanded ? 'Küçült' : 'Tam sahne'}
              </button>
            </>
          )}
        </div>
      </div>

      {collapsed ? null : (
        <>
          <div className="mind-map-jumps" role="list">
            <button
              type="button"
              className="mind-map-jump mind-map-jump--hub"
              role="listitem"
              onClick={() => {
                setOpenIds(new Set())
                pendingFocusRef.current = [
                  'central',
                  ...branches.map((_, i) => `b-${i}`),
                ]
                openDetail({
                  label: String(data.central || title || 'Konu'),
                  kind: 'central',
                  children: branches.map((b) => b.label),
                })
              }}
            >
              Merkez
            </button>
            {branches.map((b, i) => {
              const bid = `b-${i}`
              const isOpen = openIds.has(bid)
              const color = branchColors[i % branchColors.length]!
              return (
                <button
                  key={`${b.label}-${i}`}
                  type="button"
                  className={`mind-map-jump${isOpen ? ' mind-map-jump--active' : ''}`}
                  role="listitem"
                  style={{
                    borderColor: `${color}66`,
                    ['--jump-glow' as string]: color,
                  }}
                  onClick={() =>
                    toggleBranch(bid, {
                      label: b.label,
                      kind: 'branch',
                      children: b.children,
                      color,
                      page: b.page,
                      branchId: bid,
                      childCount: b.children?.length ?? 0,
                    })
                  }
                >
                  <span
                    className="mind-map-legend__dot"
                    style={{ background: color }}
                  />
                  {b.label.length > 28 ? `${b.label.slice(0, 26)}…` : b.label}
                </button>
              )
            })}
          </div>

          <div className="mind-map-stage">
            {canvas}
            {detail && !coarse ? (
              <div className="mind-map-stage__detail">{detailCard}</div>
            ) : null}
          </div>

          {detail && coarse
            ? createPortal(
                <div
                  className="mind-map-sheet-backdrop"
                  onClick={closeDetail}
                  role="presentation"
                >
                  <div onClick={(e) => e.stopPropagation()} role="presentation">
                    {detailCard}
                  </div>
                </div>,
                document.body,
              )
            : null}
        </>
      )}
    </div>
  )

  if (expanded) {
    return createPortal(
      <div className="mind-map-overlay" role="dialog" aria-modal="true">
        {panel}
      </div>,
      document.body,
    )
  }

  return panel
}

/** Build a simple map when AI mind_map is missing but key_concepts exist. */
export function mindMapFromConcepts(
  title: string,
  concepts: string[],
): MindMapData | null {
  const clean = concepts.map((c) => c.trim()).filter(Boolean).slice(0, 6)
  if (clean.length < 2) return null
  return {
    central: title.slice(0, 72) || 'Konu',
    branches: clean.map((label) => ({ label, children: [] })),
  }
}
