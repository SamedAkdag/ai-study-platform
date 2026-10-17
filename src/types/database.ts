export type BookStatus = 'processing' | 'ready' | 'failed'
export type ChapterStatus = 'pending' | 'generating' | 'ready' | 'failed'

export type Book = {
  id: string
  user_id: string | null
  title: string
  subject: string | null
  file_url: string | null
  total_pages: number | null
  status: BookStatus
  progress_step: string | null
  error_message: string | null
  study_seconds: number | null
  share_token: string | null
  is_public: boolean | null
  view_count: number | null
  share_count: number | null
  created_at: string
}

export type QuizType = 'mcq' | 'true_false' | 'short'

export type PracticeDifficultyTag = 'easy' | 'medium' | 'hard'

export type QuizItem = {
  type?: QuizType
  question: string
  options: string[]
  correct_index: number
  correct_text?: string | null
  explanation: string
  /** Set when generated on-demand in Alıştır */
  difficulty?: PracticeDifficultyTag
}

export type ExampleItem = {
  problem: string
  solution_steps: string[]
  /** Set when generated on-demand in Alıştır */
  difficulty?: PracticeDifficultyTag
}

export type PageSource = {
  page: number
  topics: string[]
  excerpt: string
}

export type MindMapBranch = {
  label: string
  children?: string[]
}

export type MindMapData = {
  central: string
  branches: MindMapBranch[]
}

/** AI-authored Stories flashcard (from practice generation). */
export type FlashcardItem = {
  /** Pedagogical role: hook | teach | concept | check | trap | summary */
  role?: string
  label?: string
  front: string
  back: string
}

export type Chapter = {
  id: string
  book_id: string
  chapter_number: number
  order_index: number | null
  title: string
  start_page: number
  end_page: number
  summary: string | null
  key_concepts: string[] | null
  explanation: string | null
  explanation_brief: string | null
  explanation_detailed: string | null
  generation_style: string | null
  page_sources: PageSource[] | null
  examples: ExampleItem[] | null
  quiz: QuizItem[] | null
  flashcards: FlashcardItem[] | null
  mind_map: MindMapData | null
  page_text: string | null
  status: ChapterStatus
  created_at: string
}

export type Message = {
  id: string
  chapter_id: string
  user_id: string | null
  role: 'user' | 'assistant'
  content: string
  selection_quote?: string | null
  created_at: string
}

export type QuizResult = {
  id: string
  chapter_id: string
  user_id: string | null
  score: number
  total: number
  answers: Record<string, unknown> | null
  created_at: string
}

export type ChapterProgressRow = {
  id: string
  user_id: string
  book_id: string
  chapter_id: string
  opened_at: string | null
  quiz_ok: number | null
  quiz_total: number | null
  quiz_at: string | null
  updated_at: string
}

export type PdfAnnotationRow = {
  id: string
  user_id: string | null
  book_id: string
  page: number
  kind: string
  quote: string
  body: string | null
  cite_style: string | null
  ai_mode: string | null
  question: string | null
  anchor_top_pct: number | null
  anchor_left_pct: number | null
  created_at: string
}

export type SrsItemRow = {
  id: string
  user_id: string
  book_id: string
  chapter_id: string
  item_key: string
  ease: number
  interval_days: number
  repetitions: number
  due_at: string
  last_grade: number | null
  updated_at: string
}

export type InviteRole = 'admin' | 'write' | 'read'
export type GroupRole = 'owner' | InviteRole

export type StudyGroup = {
  id: string
  book_id: string
  created_at: string
  focus_chapter_id?: string | null
  focus_note?: string | null
  focus_set_by?: string | null
  focus_updated_at?: string | null
}

export type GroupInvite = {
  id: string
  group_id: string
  token: string
  role: InviteRole
  label: string | null
  max_uses: number | null
  use_count: number
  revoked_at: string | null
  created_at: string
}

export type GroupMember = {
  id: string
  group_id: string
  member_key: string
  display_name: string
  role: GroupRole
  invite_id: string | null
  user_id: string | null
  joined_at: string
}

export type ContributionKind = 'quiz' | 'example' | 'explanation'
export type ContributionStatus = 'pending' | 'approved' | 'rejected'

export type ChapterContribution = {
  id: string
  group_id: string
  chapter_id: string
  member_id: string | null
  author_name: string
  kind: ContributionKind
  payload: Record<string, unknown>
  status: ContributionStatus
  review_note: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

export type Profile = {
  user_id: string
  username: string
  display_name: string
  bio: string | null
  created_at: string
}

export type Friendship = {
  id: string
  requester_id: string
  addressee_id: string
  status: 'pending' | 'accepted' | 'declined'
  created_at: string
  updated_at: string
}

export type StudyShare = {
  id: string
  from_user_id: string
  to_user_id: string
  book_id: string
  note: string | null
  created_at: string
  read_at: string | null
}

export type StudyFocus = {
  id: string
  user_id: string
  book_id: string
  chapter_id: string | null
  day: string
  seconds: number
  updated_at: string
}

export type GroupMessage = {
  id: string
  group_id: string
  chapter_id: string | null
  member_id: string | null
  author_name: string
  author_role: GroupRole
  body: string
  created_at: string
}

type TableDef<Row, Insert, Update> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

export type Database = {
  public: {
    Tables: {
      books: TableDef<
        Book,
        {
          id?: string
          user_id?: string | null
          title: string
          subject?: string | null
          file_url?: string | null
          total_pages?: number | null
          status?: BookStatus
          progress_step?: string | null
          error_message?: string | null
          study_seconds?: number | null
          share_token?: string | null
          is_public?: boolean | null
          view_count?: number | null
          share_count?: number | null
          created_at?: string
        },
        Partial<Book>
      >
      chapters: TableDef<
        Chapter,
        {
          id?: string
          book_id: string
          chapter_number: number
          order_index?: number | null
          title: string
          start_page: number
          end_page: number
          summary?: string | null
          key_concepts?: string[] | null
          explanation?: string | null
          explanation_brief?: string | null
          explanation_detailed?: string | null
          generation_style?: string | null
          page_sources?: PageSource[] | null
          examples?: ExampleItem[] | null
          quiz?: QuizItem[] | null
          flashcards?: FlashcardItem[] | null
          mind_map?: MindMapData | null
          page_text?: string | null
          status?: ChapterStatus
          created_at?: string
        },
        Partial<Chapter>
      >
      messages: TableDef<
        Message,
        {
          id?: string
          chapter_id: string
          user_id?: string | null
          role: 'user' | 'assistant'
          content: string
          selection_quote?: string | null
          created_at?: string
        },
        Partial<Message>
      >
      quiz_results: TableDef<
        QuizResult,
        {
          id?: string
          chapter_id: string
          user_id?: string | null
          score: number
          total: number
          answers?: Record<string, unknown> | null
          created_at?: string
        },
        Partial<QuizResult>
      >
      chapter_progress: TableDef<
        ChapterProgressRow,
        {
          id?: string
          user_id: string
          book_id: string
          chapter_id: string
          opened_at?: string | null
          quiz_ok?: number | null
          quiz_total?: number | null
          quiz_at?: string | null
          updated_at?: string
        },
        Partial<ChapterProgressRow>
      >
      pdf_annotations: TableDef<
        PdfAnnotationRow,
        {
          id?: string
          user_id?: string | null
          book_id: string
          page: number
          kind: string
          quote?: string
          body?: string | null
          cite_style?: string | null
          ai_mode?: string | null
          question?: string | null
          anchor_top_pct?: number | null
          anchor_left_pct?: number | null
          created_at?: string
        },
        Partial<PdfAnnotationRow>
      >
      srs_items: TableDef<
        SrsItemRow,
        {
          id?: string
          user_id: string
          book_id: string
          chapter_id: string
          item_key?: string
          ease?: number
          interval_days?: number
          repetitions?: number
          due_at: string
          last_grade?: number | null
          updated_at?: string
        },
        Partial<SrsItemRow>
      >
      study_groups: TableDef<
        StudyGroup,
        {
          id?: string
          book_id: string
          created_at?: string
          focus_chapter_id?: string | null
          focus_note?: string | null
          focus_set_by?: string | null
          focus_updated_at?: string | null
        },
        Partial<StudyGroup>
      >
      group_invites: TableDef<
        GroupInvite,
        {
          id?: string
          group_id: string
          token: string
          role: InviteRole
          label?: string | null
          max_uses?: number | null
          use_count?: number
          revoked_at?: string | null
          created_at?: string
        },
        Partial<GroupInvite>
      >
      group_members: TableDef<
        GroupMember,
        {
          id?: string
          group_id: string
          member_key: string
          display_name: string
          role: GroupRole
          invite_id?: string | null
          user_id?: string | null
          joined_at?: string
        },
        Partial<GroupMember>
      >
      group_messages: TableDef<
        GroupMessage,
        {
          id?: string
          group_id: string
          chapter_id?: string | null
          member_id?: string | null
          author_name: string
          author_role: GroupRole
          body: string
          created_at?: string
        },
        Partial<GroupMessage>
      >
      chapter_contributions: TableDef<
        ChapterContribution,
        {
          id?: string
          group_id: string
          chapter_id: string
          member_id?: string | null
          author_name: string
          kind: ContributionKind
          payload: Record<string, unknown>
          status?: ContributionStatus
          review_note?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          created_at?: string
        },
        Partial<ChapterContribution>
      >
      profiles: TableDef<
        Profile,
        {
          user_id: string
          username: string
          display_name: string
          bio?: string | null
          created_at?: string
        },
        Partial<Profile>
      >
      friendships: TableDef<
        Friendship,
        {
          id?: string
          requester_id: string
          addressee_id: string
          status?: Friendship['status']
          created_at?: string
          updated_at?: string
        },
        Partial<Friendship>
      >
      study_shares: TableDef<
        StudyShare,
        {
          id?: string
          from_user_id: string
          to_user_id: string
          book_id: string
          note?: string | null
          created_at?: string
          read_at?: string | null
        },
        Partial<StudyShare>
      >
      study_focus: TableDef<
        StudyFocus,
        {
          id?: string
          user_id: string
          book_id: string
          chapter_id?: string | null
          day?: string
          seconds?: number
          updated_at?: string
        },
        Partial<StudyFocus>
      >
    }
    Views: {
      public_shared_books: {
        Row: {
          id: string
          title: string
          subject: string | null
          share_token: string | null
          created_at: string | null
          is_public: boolean | null
          view_count: number | null
          share_count: number | null
        }
        Relationships: []
      }
      public_shared_chapters: {
        Row: {
          id: string
          book_id: string
          chapter_number: number
          order_index: number | null
          title: string
          summary: string | null
          key_concepts: string[] | null
          explanation: string | null
          explanation_brief: string | null
          explanation_detailed: string | null
          examples: ExampleItem[] | null
          quiz: QuizItem[] | null
          flashcards: FlashcardItem[] | null
          mind_map: MindMapData | null
          status: string
        }
        Relationships: []
      }
    }
    Functions: {
      bump_study_focus: {
        Args: {
          p_user_id: string
          p_book_id: string
          p_chapter_id: string | null
          p_seconds: number
        }
        Returns: undefined
      }
      record_book_view: {
        Args: { p_book_id: string }
        Returns: undefined
      }
      bump_book_share_count: {
        Args: { p_book_id: string }
        Returns: undefined
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
