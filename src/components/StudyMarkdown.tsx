import type { ReactNode } from 'react'
import { useMemo, useRef } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { isAiNoteBlockquote } from '@/lib/aiNotes'
import { normalizeMarkdownTables } from '@/lib/normalizeMarkdownTables'

/** OCR tablo klipleri data: URL olarak gelir — varsayılan transform bunları düşürür. */
function studyUrlTransform(url: string): string {
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(url)) {
    return url
  }
  return defaultUrlTransform(url)
}

type Props = {
  markdown: string
  /** Compact styling for chat bubbles */
  compact?: boolean
}

export type CalloutKind =
  | 'note'
  | 'analogy'
  | 'warning'
  | 'key'
  | 'summary'
  | 'definition'
  | 'exam'
  | 'default'

function flattenText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenText).join('')
  if (typeof node === 'object' && node !== null && 'props' in node) {
    return flattenText(
      (node as { props?: { children?: ReactNode } }).props?.children,
    )
  }
  return ''
}

/**
 * `<!-- study:boxes -->` işaretlerini kaldır; sıradaki tablolar için kuyruk üret.
 */
function stripBoxMarkers(md: string): { text: string; boxFlags: boolean[] } {
  const lines = String(md || '').split(/\r?\n/)
  const out: string[] = []
  const boxFlags: boolean[] = []
  let nextBoxes = false
  let inTable = false

  for (const line of lines) {
    const t = (line ?? '').trim()
    if (/<!--\s*study:boxes\s*-->/.test(t)) {
      nextBoxes = true
      continue
    }
    const isSep =
      t.includes('|') &&
      /^[\s|:–—-]+$/.test(t) &&
      /-/.test(t)
    const isRow = /^\|.+\|/.test(t) && !isSep

    if (isRow && !inTable) {
      boxFlags.push(nextBoxes)
      nextBoxes = false
      inTable = true
    } else if (inTable && t === '') {
      inTable = false
    } else if (inTable && !isRow && !isSep) {
      inTable = false
    }

    out.push(line ?? '')
  }

  return { text: out.join('\n'), boxFlags }
}

/** Map blockquote lead labels → textbook callout chrome. */
export function calloutKindFromText(text: string): CalloutKind {
  const t = String(text || '').trim()
  if (isAiNoteBlockquote(t)) return 'note'
  if (/^(benzetme|analoji|örnekle)\b/i.test(t)) return 'analogy'
  if (/^(dikkat|uyan|yanılgı|sık hata|yanlış)\b/i.test(t)) return 'warning'
  if (/^(önemli|kilit|anahtar|unutma|tip)\b/i.test(t)) return 'key'
  if (/^(özet|kısa özet|hatırla)\b/i.test(t)) return 'summary'
  if (/^(tanım|kavram)\b/i.test(t)) return 'definition'
  if (/^(sınav\s*kart|ezber|flash)\b/i.test(t)) return 'exam'
  return 'default'
}

function calloutClass(kind: CalloutKind): string {
  if (kind === 'note') return 'study-callout study-callout--note'
  if (kind === 'analogy') return 'study-callout study-callout--analogy'
  if (kind === 'warning') return 'study-callout study-callout--warning'
  if (kind === 'key') return 'study-callout study-callout--key'
  if (kind === 'summary') return 'study-callout study-callout--summary'
  if (kind === 'definition') return 'study-callout study-callout--definition'
  if (kind === 'exam') return 'study-callout study-callout--exam'
  return 'study-callout'
}

/**
 * Study content markdown — GFM tables, KaTeX, Pearson-like callouts.
 */
export default function StudyMarkdown({ markdown, compact }: Props) {
  const prepared = useMemo(() => {
    const stripped = stripBoxMarkers(markdown || '')
    return {
      text: normalizeMarkdownTables(stripped.text),
      boxFlags: stripped.boxFlags,
    }
  }, [markdown])

  const nextTableExam = useRef(false)
  const boxFlagIdx = useRef(0)
  // Reset index each render so table components read flags in order
  boxFlagIdx.current = 0

  return (
    <div
      className={
        compact
          ? 'study-md study-md--compact study-textbook'
          : 'study-md study-textbook'
      }
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={studyUrlTransform}
        components={{
          img: ({ src, alt }) => (
            <figure className="study-md__figure-wrap">
              <img
                src={src}
                alt={alt || 'Tablo'}
                className="study-md__figure"
                loading="lazy"
              />
              {alt && alt !== 'Tablo' && alt !== 'Şekil' && alt !== 'Gösterge' ? (
                <figcaption className="study-md__figcaption">{alt}</figcaption>
              ) : null}
            </figure>
          ),
          h1: ({ children }) => (
            <h1 className="study-h study-h--1">{children}</h1>
          ),
          h2: ({ children }) => {
            const text = flattenText(children)
            const isExam = /sınav\s*kart/i.test(text)
            nextTableExam.current = isExam
            return (
              <h2
                className={
                  isExam
                    ? 'study-h study-h--2 study-exam-heading'
                    : 'study-h study-h--2'
                }
              >
                {children}
              </h2>
            )
          },
          h3: ({ children }) => (
            <h3 className="study-h study-h--3">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="study-h study-h--4">{children}</h4>
          ),
          p: ({ children }) => <p className="study-p">{children}</p>,
          ul: ({ children }) => (
            <ul className="study-list study-list--ul">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="study-list study-list--ol">{children}</ol>
          ),
          hr: () => <hr className="study-rule" />,
          blockquote: ({ children }) => {
            const text = flattenText(children)
            const kind = calloutKindFromText(text)
            return (
              <blockquote className={calloutClass(kind)}>{children}</blockquote>
            )
          },
          table: ({ children }) => {
            const exam = nextTableExam.current
            nextTableExam.current = false
            const flagged = prepared.boxFlags[boxFlagIdx.current] === true
            boxFlagIdx.current += 1
            // Yalnızca açıkça işaretli kutu tabloları — kısa hücre tahmini yapma
            const boxes = flagged
            const wrapClass = exam
              ? 'study-table-wrap study-table-wrap--exam'
              : boxes
                ? 'study-table-wrap study-table-wrap--boxes'
                : 'study-table-wrap'
            const tableClass = boxes
              ? 'study-table study-table--boxes'
              : 'study-table'
            return (
              <div className={wrapClass}>
                <table className={tableClass}>{children}</table>
              </div>
            )
          },
          thead: ({ children }) => <thead>{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => <tr>{children}</tr>,
          th: ({ children }) => <th scope="col">{children}</th>,
          td: ({ children }) => <td>{children}</td>,
        }}
      >
        {prepared.text}
      </ReactMarkdown>
    </div>
  )
}

export { flattenText }
