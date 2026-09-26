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
  created_at: string
}

export type QuizItem = {
  question: string
  options: string[]
  correct_index: number
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

export type Database = {
  public: {
    Tables: {
      books: {
        Row: Book
        Insert: {
          id?: string
          user_id?: string | null
          title: string
          subject?: string | null
          file_url?: string | null
          total_pages?: number | null
          status?: BookStatus
          progress_step?: string | null
          error_message?: string | null
          created_at?: string
        }
        Update: Partial<Book>
      }
      chapters: {
        Row: Chapter
        Insert: {
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
        }
        Update: Partial<Chapter>
      }
      messages: {
        Row: Message
        Insert: {
          id?: string
          chapter_id: string
          user_id?: string | null
          role: 'user' | 'assistant'
          content: string
          created_at?: string
        }
        Update: Partial<Message>
      }
    }
  }
}
