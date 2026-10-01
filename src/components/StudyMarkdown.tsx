import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { isAiNoteBlockquote } from '@/lib/aiNotes'
import { normalizeMarkdownTables } from '@/lib/normalizeMarkdownTables'

type Props = {
  markdown: string
  /** Compact styling for chat bubbles */
  compact?: boolean
}

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
 * Study content markdown with GFM tables styled for Studium.
 */
export default function StudyMarkdown({ markdown, compact }: Props) {
  const source = normalizeMarkdownTables(markdown)
  return (
    <div className={compact ? 'study-md study-md--compact' : 'study-md'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          blockquote: ({ children }) => {
            const text = flattenText(children)
            const isNote = isAiNoteBlockquote(text)
            return (
              <blockquote className={isNote ? 'study-ai-note' : undefined}>
                {children}
              </blockquote>
            )
          },
          table: ({ children }) => (
            <div className="study-table-wrap">
              <table className="study-table">{children}</table>
            </div>
          ),
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
