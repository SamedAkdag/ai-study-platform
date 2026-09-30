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
  created_at: string
}

export type QuizType = 'mcq' | 'true_false' | 'short'

export type QuizItem = {
  type?: QuizType
  question: string
  options: string[]
  correct_index: number
  correct_text?: string | null
  explanation: string
}

export type ExampleItem = {
  problem: string
  solution_steps: string[]
}

export type PageSource = {
  page: number
  topics: string[]
  excerpt: string
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
  created_at: string
}

export type InviteRole = 'admin' | 'write' | 'read'
export type GroupRole = 'owner' | InviteRole

export type StudyGroup = {
  id: string
  book_id: string
  created_at: string
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
          created_at?: string
        },
        Partial<Message>
      >
      study_groups: TableDef<
        StudyGroup,
        {
          id?: string
          book_id: string
          created_at?: string
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
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
