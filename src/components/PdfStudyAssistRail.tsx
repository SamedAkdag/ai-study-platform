import type { ReactNode } from 'react'
import PdfAssistIdle from '@/components/PdfAssistIdle'
import PdfAiPanel from '@/components/PdfAiPanel'
import type { PdfSelectionPayload } from '@/types/pdfSelection'
import type { PageSource } from '@/lib/sourceLookup'

export type PdfAssistMode = 'ask' | 'summarize' | 'explain' | 'translate'

type Props = {
  bookTitle?: string
  noteCount?: number
  chapterId: string
  chapterTitle: string
  payload: PdfSelectionPayload | null
  mode: PdfAssistMode | null
  seedQuestion?: string | null
  pageSources?: PageSource[] | null
  onJumpPage?: (page: number) => void
  onCloseAssist: () => void
  onSaveToBook?: (body: string, question?: string) => void | Promise<void>
  /** @deprecated Corner CTA owns the hint — kept for call-site compatibility. */
  onIdleHint?: () => void
  /** Hide idle companion (e.g. another draft panel is open). */
  hideIdle?: boolean
  /** Extra blocks (note draft, cite, organize, notes list). */
  children?: ReactNode
}

/**
 * Shared PDF AI rail — quiet idle + active ask/summary panel.
 */
export default function PdfStudyAssistRail({
  bookTitle,
  noteCount = 0,
  chapterId,
  chapterTitle,
  payload,
  mode,
  seedQuestion = null,
  pageSources = null,
  onJumpPage,
  onCloseAssist,
  onSaveToBook,
  hideIdle = false,
  children,
}: Props) {
  const hasChat = Boolean(payload && mode)

  return (
    <div className="pdf-shadow-rail">
      {hasChat ? (
        <div className="pdf-shadow-rail__bar">
          <p className="pdf-shadow-rail__title">AI</p>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={onCloseAssist}
          >
            Kapat
          </button>
        </div>
      ) : null}

      {!hasChat && !hideIdle ? (
        <PdfAssistIdle bookTitle={bookTitle} noteCount={noteCount} />
      ) : null}

      {hasChat ? (
        <PdfAiPanel
          chapterId={chapterId}
          chapterTitle={chapterTitle}
          payload={payload}
          mode={mode}
          seedQuestion={seedQuestion}
          pageSources={pageSources}
          onJumpPage={onJumpPage}
          onClose={onCloseAssist}
          onSaveToBook={onSaveToBook}
        />
      ) : null}

      {children}
    </div>
  )
}
