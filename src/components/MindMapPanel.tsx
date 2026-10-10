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
  /** Chapter study notes — used to narrate the clicked node */
  markdown?: string | null
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
              borderColor: `${color}66`,
              background: `${color}14`,
              color,
            }
          : kind === 'leaf' && color
            ? { borderColor: `${color}33` }
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
  const charsPerLine = kind === 'leaf' ? 34 : kind === 'branch' ? 26 : 22
  const lines = Math.max(1, Math.ceil(label.replace(/\s+/g, ' ').trim().length / charsPerLine))
  const lineH = kind === 'central' ? 20 : 17
  const pad = kind === 'leaf' ? 20 : 24
  const maxLines = kind === 'leaf' ? 5 : 3
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

    const childSeen = new Set<string>()
    const children: string[] = []
    for (const c of b.children ?? []) {
      const cl = String(c || '').replace(/\s+/g, ' ').trim()
      const ck = cl.toLowerCase()
      if (!cl || ck === key || childSeen.has(ck)) continue
      childSeen.add(ck)
      children.push(cl)
      if (children.length >= 8) break
    }
    out.push({ label, children })
    if (out.length >= 8) break
  }
  return out
}

function layoutMindMap(data: MindMapData): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const branches = tidyBranches(data.branches ?? [])

  const COL = { central: 16, branch: 250, leaf: 520 }
  const ROW_GAP = 14
  const BRANCH_GAP = 22
  const centralLabel = String(data.central || 'Konu').replace(/\s+/g, ' ').trim()

  type LeafLayout = { label: string; h: number }
  type BranchLayout = {
    label: string
    h: number
    kids: LeafLayout[]
    blockH: number
  }

  const laid: BranchLayout[] = branches.map((b) => {
    const kids = (b.children ?? []).map((label) => ({
      label,
      h: estimateHeight(label, 'leaf'),
    }))
    const kidsH =
      kids.length === 0
        ? 0
        : kids.reduce((s, k) => s + k.h, 0) + (kids.length - 1) * ROW_GAP
    const branchH = estimateHeight(b.label, 'branch')
    return {
      label: b.label,
      h: branchH,
      kids,
      blockH: Math.max(branchH, kidsH || branchH),
    }
  })

  const totalH =
    laid.reduce((s, b) => s + b.blockH, 0) +
    Math.max(0, laid.length - 1) * BRANCH_GAP

  const startY = 20
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
    draggable: true,
  })

  let cursorY = startY
  laid.forEach((branch, i) => {
    const color = BRANCH_COLORS[i % BRANCH_COLORS.length]!
    const bid = `b-${i}`
    const by = cursorY + branch.blockH / 2 - branch.h / 2
    const childLabels = branch.kids.map((k) => k.label)

    nodes.push({
      id: bid,
      type: 'concept',
      position: { x: COL.branch, y: by },
      data: {
        label: branch.label,
        kind: 'branch',
        color,
        children: childLabels,
      } satisfies NodeData,
      draggable: true,
    })

    edges.push({
      id: `e-c-${i}`,
      source: 'central',
      target: bid,
      type: 'bezier',
      style: { stroke: color, strokeWidth: 1.75 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 14,
        height: 14,
        color,
      },
    })

    const kidsH =
      branch.kids.length === 0
        ? 0
        : branch.kids.reduce((s, k) => s + k.h, 0) +
          (branch.kids.length - 1) * ROW_GAP
    let ky = cursorY + Math.max(0, (branch.blockH - kidsH) / 2)

    branch.kids.forEach((child, j) => {
      const kid = `b-${i}-c-${j}`
      nodes.push({
        id: kid,
        type: 'concept',
        position: { x: COL.leaf, y: ky },
        data: {
          label: child.label,
          kind: 'leaf',
          color,
        } satisfies NodeData,
        draggable: true,
      })
      edges.push({
        id: `e-${i}-${j}`,
        source: bid,
        target: kid,
        type: 'bezier',
        style: { stroke: `${color}99`, strokeWidth: 1.3 },
      })
      ky += child.h + ROW_GAP
    })

    cursorY += branch.blockH + BRANCH_GAP
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
    const mq = window.matchMedia('(pointer: coarse), (max-width: 720px)')
    const apply = () => setCoarse(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  return coarse
}

/** Interactive concept map — click a node for a short topic sheet + TTS. */
export default function MindMapPanel({ data, title, markdown }: Props) {
  const branches = useMemo(
    () => tidyBranches(data.branches ?? []),
    [data.branches],
  )
  const { nodes, edges } = useMemo(() => layoutMindMap(data), [data])
  const [detail, setDetail] = useState<MindMapTopicDetail | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [rf, setRf] = useState<ReactFlowInstance | null>(null)
  const detailRef = useRef<HTMLElement | null>(null)
  const coarse = useCoarsePointer()

  useEffect(() => {
    if (!expanded) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [expanded])

  useEffect(() => {
    if (!detail || expanded) return
    detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [detail, expanded])

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

  function fitMap() {
    void rf?.fitView({ padding: coarse ? 0.18 : 0.22, maxZoom: 1, duration: 280 })
  }

  if (!branches.length) return null

  const canvas = (
    <div className={`mind-map-canvas ${expanded ? 'mind-map-canvas--expanded' : ''}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={setRf}
        fitView
        fitViewOptions={{ padding: coarse ? 0.16 : 0.22, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={!coarse}
        nodesConnectable={false}
        elementsSelectable
        panOnScroll={!coarse}
        zoomOnScroll={!coarse}
        zoomOnPinch
        panOnDrag
        preventScrolling
        onNodeClick={onNodeClick}
        defaultEdgeOptions={{ type: 'bezier' }}
      >
        <Background gap={20} color="rgba(22,37,50,0.05)" />
        <Controls showInteractive={false} />
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
          <p className="muted text-[11px]">
            {coarse
              ? 'Parmakla kaydır · iki parmak yakınlaştır · dal seç veya düğüme dokun'
              : 'Düğüme tıkla → anlatım · tekerlek yakınlaştır · sürükle'}
          </p>
        </div>
        <div className="mind-map-panel__tools">
          <button type="button" className="btn-ghost text-xs" onClick={fitMap}>
            Sığdır
          </button>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => {
              setExpanded((v) => !v)
              window.setTimeout(fitMap, 80)
            }}
          >
            {expanded ? 'Küçült' : 'Tam ekran'}
          </button>
        </div>
      </div>

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
              style={{ background: BRANCH_COLORS[i % BRANCH_COLORS.length] }}
            />
            {b.label.length > 28 ? `${b.label.slice(0, 26)}…` : b.label}
          </button>
        ))}
      </div>

      {canvas}

      {/* Desktop / inline detail; mobile sheet portals below */}
      {detail && !coarse ? detailCard : null}
      {detail && coarse
        ? createPortal(
            <div
              className="mind-map-sheet-backdrop"
              onClick={closeDetail}
              role="presentation"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                role="presentation"
              >
                {detailCard}
              </div>
            </div>,
            document.body,
          )
        : null}
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
