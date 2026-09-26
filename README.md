# AI Study Platform

Client-side PDF text extraction (`pdfjs-dist`) + Groq-powered dynamic chapter segmentation via Supabase Edge Functions.

## Stack

- React + Vite + TypeScript + Tailwind CSS
- Supabase (Postgres + Edge Functions)
- Groq (`qwen/qwen3.8-27b` — Qwen via Groq)

## Setup

1. `npm install`
2. Copy `.env.example` → `.env.local` and fill `VITE_SUPABASE_*`
3. Run the SQL in `supabase/migrations/` in the Supabase SQL editor (or `supabase db push`)
4. Deploy the function and set secrets:

```bash
supabase functions deploy segment-chapters
supabase secrets set GROQ_API_KEY=your_key
```

Never commit API keys. Rotate any key that was pasted into chat.

5. `npm run dev`

## Milestone notes

- PDF parsing happens **only in the browser** (not in Edge Functions)
- Chapters ≈ ~5-page study units (PDF blocks) used to generate materials
- Sliding windows: 5 pages, 1-page overlap → then pack to 4–7 pages
- `generate-chapter-content` builds explanation / examples / quiz per chapter
- Edge Functions strip ```json markdown fences before parsing AI output
- Auth + isolated RAG chat = next
