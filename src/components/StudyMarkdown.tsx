import type { ReactNode } from 'react'
import { useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { isAiNoteBlockquote } from '@/lib/aiNotes'
import { normalizeMarkdownTables } from '@/lib/normalizeMarkdownTables'

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

/** Map blockquote lead labels → textbook callout chrome. */
export function calloutKindFromText(text: string): CalloutKind {
  const t = text.trim()
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
  const source = normalizeMarkdownTables(markdown)
  const nextTableExam = useRef(false)

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
        components={{
          h2: ({ children }) => {
            const text = flattenText(children)
            const isExam = /sınav\s*kart/i.test(text)
            nextTableExam.current = isExam
            return (
              <h2 className={isExam ? 'study-exam-heading' : undefined}>
                {children}
              </h2>
            )
          },
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
            return (
              <div
                className={
                  exam
                    ? 'study-table-wrap study-table-wrap--exam'
                    : 'study-table-wrap'
                }
              >
                <table className="study-table">{children}</table>
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
        {source}
      </ReactMarkdown>
    </div>
  )
}

export { flattenText }
