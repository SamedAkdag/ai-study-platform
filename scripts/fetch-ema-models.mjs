/**
 * Download EMA Lightning ONNX assets into public/models/ema/
 * so the app serves them from our origin (no Hugging Face on every visit).
 *
 * Usage:
 *   node scripts/fetch-ema-models.mjs
 *   node scripts/fetch-ema-models.mjs --force
 */
import { createWriteStream } from 'node:fs'
import { mkdir, access, stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'public', 'models', 'ema')
const BASE =
  'https://huggingface.co/ozcancelik/ema-lightning-onnx/resolve/main/'

const FILES = [
  'meta.json',
  'normalizer.wasm',
  'text.onnx',
  'sound.onnx',
  'decoder.onnx',
  'LICENSE',
  'NOTICE',
]

const force = process.argv.includes('--force')

async function exists(file) {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

async function download(name) {
  const dest = path.join(OUT, name)
  if (!force && (await exists(dest))) {
    const s = await stat(dest)
    if (s.size > 64) {
      console.log(`skip  ${name} (${(s.size / 1e6).toFixed(1)} MB)`)
      return
    }
  }
  const url = `${BASE}${name}`
  console.log(`get   ${name}…`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  if (!res.body) throw new Error(`${name}: empty body`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
  const s = await stat(dest)
  console.log(`ok    ${name} (${(s.size / 1e6).toFixed(1)} MB)`)
}

await mkdir(OUT, { recursive: true })
for (const f of FILES) await download(f)
console.log(`\nEMA models ready at public/models/ema/ → served as /models/ema/`)
