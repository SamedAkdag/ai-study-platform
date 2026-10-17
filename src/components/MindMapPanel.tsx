import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Background,
  Controls,
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
import type { MindMapData } from '@/types/database'
import {
  buildMindMapTopicDetail,
  type MindMapTopicDetail,
} from '@/lib/mindMapTopicDetail'
import {
  getStoredLang,
  getStoredRate,
  getStoredVoiceUri,
  isTtsSupported,
  speakText,
  stopSpeech,
} from '@/lib/tts'

type Props = {
  data: MindMapData
  title?: string
  markdown?: string | null
  defaultCollapsed?: boolean
}

const BRANCH_COLORS = [
  '#0f766e',
  '#1d4e89',
  '#9a7b4f',
  '#0b5a54',
  '#5a6d7c',
  '#14837a',
]

type NodeData = {
  label: string
  kind: 'central' | 'branch' | 'leaf'
  color?: string
  children?: string[]
}

function ConceptNode({ data }: NodeProps) {
  const kind = String((data as NodeData).kind || 'branch')
  const label = String((data as NodeData).label || '')
  const color = String((data as NodeData).color || '')
  return (
    <div
      className={`mind-node mind-node--${kind}`}
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
      <span>{label}</span>
      {kind !== 'leaf' && (
        <Handle type="source" position={Position.Right} className="!opacity-0" />
      )}
    </div>
  )
}

const nodeTypes = { concept: ConceptNode }

type Branch = { label: string; children?: string[] }

function estimateHeight(label: string, kind: 'central' | 'branch' | 'leaf'): number {
  const charsPerLine = kind === 'leaf' ? 28 : kind === 'branch' ? 22 : 18
  const lines = Math.max(
    1,
    Math.ceil(label.replace(/\s+/g, ' ').trim().length / charsPerLine),
  )
  const lineH = kind === 'central' ? 19 : 16
  const pad = kind === 'leaf' ? 18 : 22
  const maxLines = kind === 'leaf' ? 4 : 3
  return pad + Math.min(lines, maxLines) * lineH
}

function tidyBranches(raw: Branch[]): Branch[] {
  const seen = new Set<string>()
  const out: Branch[] = []
  for (const b of raw) {
    const label = String(b.label || '').replace(/\s+/g, ' ').trim()
    if (!label) continue
    const key = label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    // Flat map only — no leaf subgroups on the canvas (detail sheet can still list them)
    const children = (b.children ?? [])
      .map((c) => String(c || '').replace(/\s+/g, ' ').trim())
      .filter((cl) => cl && cl.toLowerCase() !== key)
      .slice(0, 8)
    out.push({ label, children })
    if (out.length >= 8) break
  }
  return out
}

/** Flat L→R: merkez + ana dallar only (no leaf clutter). */
function layoutMindMap(data: MindMapData): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const branches = tidyBranches(data.branches ?? [])

  const COL = { central: 24, branch: 260 }
  const BRANCH_GAP = 16
  const centralLabel = String(data.central || 'Konu').replace(/\s+/g, ' ').trim()

  const laid = branches.map((b) => ({
    label: b.label,
    h: estimateHeight(b.label, 'branch'),
    children: b.children ?? [],
  }))

  const totalH =
    laid.reduce((s, b) => s + b.h, 0) + Math.max(0, laid.length - 1) * BRANCH_GAP

  const startY = 12
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
  laid.forEach((branch, i) => {
    const color = BRANCH_COLORS[i % BRANCH_COLORS.length]!
    const bid = `b-${i}`

    nodes.push({
      id: bid,
      type: 'concept',
      position: { x: COL.branch, y: cursorY },
      data: {
        label: branch.label,
        kind: 'branch',
        color,
        children: branch.children,
      } satisfies NodeData,
      draggable: false,
    })

    edges.push({
      id: `e-c-${i}`,
      source: 'central',
      target: bid,
      type: 'smoothstep',
      style: { stroke: color, strokeWidth: 1.5, opacity: 0.85 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 12,
        height: 12,
        color,
      },
    })

    cursorY += branch.h + BRANCH_GAP
  })

  return { nodes, edges }
}

const KIND_LABEL: Record<string, string> = {
  central: 'Merkez',
  branch: 'Ana dal',
  leaf: 'Ayrıntı',
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

/** Fill the canvas with the graph — no empty void, no wild zoom jumps. */
function fitCalm(
  rf: ReactFlowInstance | null,
  opts?: { animate?: boolean; coarse?: boolean },
) {
  if (!rf) return
  const animate = opts?.animate ?? false
  const coarse = opts?.coarse ?? false
  void rf.fitView({
    padding: coarse ? 0.1 : 0.08,
    includeHiddenNodes: false,
    minZoom: 0.55,
    maxZoom: 1.45,
    duration: animate ? 220 : 0,
  })
}

/** Interactive concept map — NotebookLM-style calm zoom & fill. */
export default function MindMapPanel({
  data,
  title,
  markdown,
  defaultCollapsed = false,
}: Props) {
  const branches = useMemo(
    () => tidyBranches(data.branches ?? []),
    [data.branches],
  )
  const { nodes, edges } = useMemo(() => layoutMindMap(data), [data])
  const [detail, setDetail] = useState<MindMapTopicDetail | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const rfRef = useRef<ReactFlowInstance | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const detailRef = useRef<HTMLElement | null>(null)
  const coarse = useCoarsePointer()

  const scheduleFit = useCallback(
    (animate = false) => {
      // Wait for layout/paint so bounds are real (avoids empty fit)
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          fitCalm(rfRef.current, { animate, coarse })
        })
      })
    },
    [coarse],
  )

  useEffect(() => {
    if (collapsed) return
    scheduleFit(false)
  }, [collapsed, nodes, edges, expanded, scheduleFit])

  useEffect(() => {
    if (collapsed || !canvasRef.current) return
    const el = canvasRef.current
    const ro = new ResizeObserver(() => scheduleFit(false))
    ro.observe(el)
    return () => ro.disconnect()
  }, [collapsed, expanded, scheduleFit])

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
    },
    [markdown, title],
  )

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_ev, node) => {
      openDetail(node.data as NodeData)
    },
    [openDetail],
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
  }

  if (!branches.length) return null

  const canvas = (
    <div
      ref={canvasRef}
      className={`mind-map-canvas ${expanded ? 'mind-map-canvas--expanded' : ''}`}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={(instance) => {
          rfRef.current = instance
          scheduleFit(false)
        }}
        minZoom={0.45}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        panOnScroll={false}
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        panOnDrag
        preventScrolling
        onNodeClick={onNodeClick}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        attributionPosition="bottom-left"
      >
        <Background
          gap={24}
          size={1}
          color="rgba(22, 37, 50, 0.045)"
        />
        <Controls showInteractive={false} showFitView={false} />
      </ReactFlow>
    </div>
  )

  const detailCard = detail ? (
    <aside
      ref={detailRef}
      className={`mind-map-detail ${coarse ? 'mind-map-detail--sheet' : ''}`}
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

      <div className="mind-map-detail__body">
        {detail.narrative.split(/\n{2,}/).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>

      {detail.points.length > 0 && (
        <div className="mind-map-detail__points">
          <p className="mind-map-detail__points-label">Bu dalda</p>
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
      className={`mind-map-panel ${expanded ? 'mind-map-panel--expanded' : ''}`}
    >
      <div className="mind-map-panel__head">
        <div>
          <p className="section-label mb-0">Konu haritası</p>
          {!collapsed && (
            <p className="muted text-[11px]">
              {coarse
                ? 'Sürükle · iki parmak yakınlaştır · düğüme dokun'
                : 'Sürükle ile gez · +/− ile yakınlaştır · düğüme tıkla'}
            </p>
          )}
        </div>
        <div className="mind-map-panel__tools">
          <button
            type="button"
            className="btn-ghost text-xs"
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
                className="btn-ghost text-xs"
                onClick={() => fitCalm(rfRef.current, { animate: true, coarse })}
              >
                Sığdır
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  setExpanded((v) => !v)
                }}
              >
                {expanded ? 'Küçült' : 'Tam ekran'}
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
              className="mind-map-jump"
              role="listitem"
              onClick={() =>
                openDetail({
                  label: String(data.central || title || 'Konu'),
                  kind: 'central',
                  children: branches.map((b) => b.label),
                })
              }
            >
              Merkez
            </button>
            {branches.map((b, i) => (
              <button
                key={`${b.label}-${i}`}
                type="button"
                className="mind-map-jump"
                role="listitem"
                style={{
                  borderColor: `${BRANCH_COLORS[i % BRANCH_COLORS.length]}55`,
                }}
                onClick={() =>
                  openDetail({
                    label: b.label,
                    kind: 'branch',
                    children: b.children,
                    color: BRANCH_COLORS[i % BRANCH_COLORS.length],
                  })
                }
              >
                <span
                  className="mind-map-legend__dot"
                  style={{
                    background: BRANCH_COLORS[i % BRANCH_COLORS.length],
                  }}
                />
                {b.label.length > 28 ? `${b.label.slice(0, 26)}…` : b.label}
              </button>
            ))}
          </div>

          {canvas}

          {detail && !coarse ? detailCard : null}
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
