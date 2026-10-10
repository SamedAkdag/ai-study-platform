import { lazy, Suspense } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/lib/auth'
import UploadPage from '@/pages/UploadPage'

const ProcessingPage = lazy(() => import('@/pages/ProcessingPage'))
const BookPage = lazy(() => import('@/pages/BookPage'))
const BookReadPage = lazy(() => import('@/pages/BookReadPage'))
const ChapterPage = lazy(() => import('@/pages/ChapterPage'))
const SharedBookPage = lazy(() => import('@/pages/SharedBookPage'))
const SharedChapterPage = lazy(() => import('@/pages/SharedChapterPage'))
const JoinInvitePage = lazy(() => import('@/pages/JoinInvitePage'))
const SocialPage = lazy(() => import('@/pages/SocialPage'))
const StatsPage = lazy(() => import('@/pages/StatsPage'))

const queryClient = new QueryClient()

function RouteFallback() {
  return (
    <div className="page-shell mx-auto max-w-lg py-20 text-center">
      <p className="muted text-sm">Yükleniyor…</p>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<UploadPage />} />
              <Route path="/processing/:bookId" element={<ProcessingPage />} />
              <Route path="/books/:bookId" element={<BookPage />} />
              <Route path="/books/:bookId/read" element={<BookReadPage />} />
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
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
