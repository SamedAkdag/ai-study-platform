# One-time local setup (run in PowerShell from project root)
# Usage: .\setup.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path .git)) {
  git init
}

git remote remove origin 2>$null
git remote add origin https://github.com/SamedAkdag/ai-study-platform.git

if (-not (Test-Path .env.local)) {
  Copy-Item .env.example .env.local
  Write-Host "Created .env.local — fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY"
}

npm install

Write-Host ""
Write-Host "Next:"
Write-Host "  1. Edit .env.local"
Write-Host "  2. Run migration SQL in Supabase"
Write-Host "  3. supabase secrets set GROQ_API_KEY=..."
Write-Host "  4. supabase functions deploy segment-chapters"
Write-Host "  5. npm run dev"
Write-Host "  6. git add . ; git commit ; git push -u origin main"
