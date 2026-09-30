import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/lib/auth'
import UploadPage from '@/pages/UploadPage'
import ProcessingPage from '@/pages/ProcessingPage'
import BookPage from '@/pages/BookPage'
import ChapterPage from '@/pages/ChapterPage'
import SharedBookPage from '@/pages/SharedBookPage'
import SharedChapterPage from '@/pages/SharedChapterPage'
import JoinInvitePage from '@/pages/JoinInvitePage'
import SocialPage from '@/pages/SocialPage'
import StatsPage from '@/pages/StatsPage'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<UploadPage />} />
            <Route path="/processing/:bookId" element={<ProcessingPage />} />
            <Route path="/books/:bookId" element={<BookPage />} />
            <Route
              path="/books/:bookId/chapters/:chapterId"
              element={<ChapterPage />}
            />
            <Route path="/s/:token" element={<SharedBookPage />} />
            <Route
              path="/s/:token/chapters/:chapterId"
              element={<SharedChapterPage />}
            />
            <Route path="/join/:inviteToken" element={<JoinInvitePage />} />
            <Route path="/social" element={<SocialPage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
