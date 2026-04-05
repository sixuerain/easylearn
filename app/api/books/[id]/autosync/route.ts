import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLocalAudioPath } from '@/lib/audio'
import path from 'path'
import { readFileSync, mkdirSync, writeFileSync } from 'fs'

const LANG_MAP: Record<string, string> = {
  zh: 'chinese', ja: 'japanese', ko: 'korean',
  en: 'english', es: 'spanish', fr: 'french',
}

async function decodeAudio(filePath: string): Promise<Float32Array> {
  const { AudioContext } = await import('node-web-audio-api')
  const ctx = new AudioContext({ sampleRate: 16000 })
  const buf = readFileSync(filePath)
  const decoded = await ctx.decodeAudioData(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  const audio = decoded.getChannelData(0)
  await ctx.close()
  return audio
}

interface Chunk { text: string; timestamp: [number | null, number | null] }

async function transcribe(audio: Float32Array, language: string): Promise<Chunk[]> {
  const { pipeline } = await import('@xenova/transformers')
  const asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base', {
    cache_dir: path.join(process.cwd(), '.whisper_cache'),
  })
  const result = await asr(audio, {
    language,
    task: 'transcribe',
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
  }) as { chunks: Chunk[] }
  return result.chunks ?? []
}

/** Extract CJK characters only */
const cjkChars = (s: string) =>
  [...s].filter(c => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(c))

/** Build character bigrams for fuzzy matching */
function bigrams(chars: string[]): Set<string> {
  const s = new Set<string>()
  for (let i = 0; i < chars.length - 1; i++) s.add(chars[i] + chars[i + 1])
  return s
}

/** Jaccard similarity between two bigram sets */
function jaccardBigrams(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

interface Anchor {
  ocrWordIdx: number   // first OCR word in this segment
  startMs: number
  endMs: number
  ocrWordCount: number // how many OCR words this segment spans
}

/**
 * Match Whisper chunks to OCR words using bigram fingerprints.
 * Returns anchor points: (ocrWordIdx, startMs, endMs) for each matched chunk.
 * Enforces monotonicity so anchors never go backwards in OCR word order.
 */
function findAnchors(
  words: { id: string; text: string }[],
  chunks: Chunk[],
  audioDurationMs: number,
): Anchor[] {
  // Filter hallucination chunks (< 3 CJK chars or null timestamps)
  const validChunks = chunks.filter(c =>
    c.timestamp[0] !== null &&
    c.timestamp[1] !== null &&
    cjkChars(c.text).length >= 3
  )

  const anchors: Anchor[] = []
  let minOcrIdx = 0  // enforce monotonicity

  // Pre-compute OCR bigrams for each word's neighbourhood (sliding window)
  const WINDOW = 18  // OCR words per match window
  const ocrWindowBigrams: Set<string>[] = []
  for (let i = 0; i < words.length; i++) {
    const winText = words.slice(i, i + WINDOW).map(w => w.text).join('')
    ocrWindowBigrams.push(bigrams(cjkChars(winText)))
  }

  for (const chunk of validChunks) {
    const chunkBG = bigrams(cjkChars(chunk.text))
    if (chunkBG.size === 0) continue

    let bestScore = 0.12  // minimum threshold
    let bestIdx = -1

    // Search OCR words from minOcrIdx, allow up to 120 words lookahead
    const limit = Math.min(words.length - WINDOW, minOcrIdx + 120)
    for (let wi = minOcrIdx; wi <= limit; wi++) {
      const score = jaccardBigrams(chunkBG, ocrWindowBigrams[wi])
      if (score > bestScore) {
        bestScore = score
        bestIdx = wi
      }
    }

    if (bestIdx < 0) continue

    // Estimate how many OCR words this chunk covers (proportional to CJK char count)
    const chunkCjkCount = cjkChars(chunk.text).length
    const ocrCharsInWindow = cjkChars(words.slice(bestIdx, bestIdx + WINDOW).map(w => w.text).join('')).length
    const wordCount = Math.max(1, Math.round((chunkCjkCount / Math.max(1, ocrCharsInWindow)) * WINDOW))

    anchors.push({
      ocrWordIdx: bestIdx,
      startMs: Math.round((chunk.timestamp[0] as number) * 1000),
      endMs:   Math.round((chunk.timestamp[1] as number) * 1000),
      ocrWordCount: wordCount,
    })

    // Advance minimum search position (allow slight overlap for inaccurate matches)
    minOcrIdx = Math.max(minOcrIdx, bestIdx + Math.max(1, wordCount - 3))
  }

  return anchors
}

/**
 * Given anchor points, assign a timestamp to every OCR word by interpolation.
 * - Words before first anchor: distributed proportionally in [0, firstAnchor.startMs]
 * - Words between anchors: distributed proportionally between the two anchors
 * - Words after last anchor: distributed proportionally in [lastAnchor.endMs, audioDurationMs]
 */
function assignTimings(
  words: { id: string; text: string }[],
  anchors: Anchor[],
  audioDurationMs: number,
): { wordId: string; startMs: number; endMs: number }[] {

  // Collapse anchors into (ocrWordIdx, ms) pairs
  // Each anchor gives us the start time of a group of OCR words
  const pts: { wordIdx: number; ms: number }[] = [{ wordIdx: 0, ms: 0 }]
  for (const a of anchors) {
    pts.push({ wordIdx: a.ocrWordIdx, ms: a.startMs })
    pts.push({ wordIdx: a.ocrWordIdx + a.ocrWordCount, ms: a.endMs })
  }
  pts.push({ wordIdx: words.length, ms: audioDurationMs })

  // Deduplicate & sort by wordIdx
  const sorted = pts
    .sort((a, b) => a.wordIdx - b.wordIdx || a.ms - b.ms)
    .filter((p, i, arr) => i === 0 || p.wordIdx > arr[i - 1].wordIdx)

  // For each word, find its interpolation segment and compute timing
  const charCounts = words.map(w => Math.max(1, cjkChars(w.text).length))
  const result: { wordId: string; startMs: number; endMs: number }[] = []

  let ptIdx = 0
  let charCumInSeg = 0

  for (let wi = 0; wi < words.length; wi++) {
    // Advance to the right segment
    while (ptIdx + 1 < sorted.length - 1 && wi >= sorted[ptIdx + 1].wordIdx) {
      ptIdx++
      charCumInSeg = 0
    }

    const segStart = sorted[ptIdx]
    const segEnd = sorted[ptIdx + 1]
    const segMs = segEnd.ms - segStart.ms

    // Total chars in this segment
    const segWords = words.slice(segStart.wordIdx, segEnd.wordIdx)
    const segTotalChars = segWords.reduce((s, w) => s + Math.max(1, cjkChars(w.text).length), 0)

    const startMs = Math.round(segStart.ms + (charCumInSeg / segTotalChars) * segMs)
    charCumInSeg += charCounts[wi]
    const endMs = Math.max(startMs + 50,
      Math.round(segStart.ms + (charCumInSeg / segTotalChars) * segMs))

    result.push({ wordId: words[wi].id, startMs, endMs })
  }

  return result
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: bookId } = await params
  const book = await prisma.book.findUnique({ where: { id: bookId } })
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const served = getLocalAudioPath(bookId)
  if (!served) {
    return NextResponse.json({ error: 'No local audio cached. Download audio first.' }, { status: 400 })
  }
  const audioFilename = served.replace(/^\/api\/audio\//, '')
  const audioPath = path.join(process.cwd(), 'storage', 'audio', audioFilename)

  const pages = await prisma.page.findMany({
    where: { bookId },
    orderBy: { pageNum: 'asc' },
    include: { words: { orderBy: { orderIdx: 'asc' } } },
  })
  const words = pages.flatMap(p => p.words)
  if (words.length === 0) {
    return NextResponse.json({ error: 'No words found. Run OCR on pages first.' }, { status: 400 })
  }

  try {
    console.log('[autosync] Decoding audio…')
    const audio = await decodeAudio(audioPath)
    const audioDurationMs = Math.round((audio.length / 16000) * 1000)

    const lang = LANG_MAP[book.language ?? 'zh'] ?? 'chinese'
    console.log(`[autosync] Transcribing ${(audioDurationMs / 1000).toFixed(1)}s (${lang})…`)
    const chunks = await transcribe(audio, lang)
    console.log(`[autosync] ${chunks.length} segments`)

    const anchors = findAnchors(words, chunks, audioDurationMs)
    console.log(`[autosync] ${anchors.length} anchors found`)
    anchors.slice(0, 5).forEach(a =>
      console.log(`  OCR[${a.ocrWordIdx}] "${words[a.ocrWordIdx]?.text}" @ ${(a.startMs/1000).toFixed(1)}s`)
    )

    const timings = assignTimings(words, anchors, audioDurationMs)

    // Save debug transcript
    const transcriptDir = path.join(process.cwd(), 'storage', 'transcripts')
    mkdirSync(transcriptDir, { recursive: true })
    writeFileSync(
      path.join(transcriptDir, `${bookId}.json`),
      JSON.stringify({ bookId, audioDurationMs, chunks, anchors,
        anchorSample: anchors.slice(0, 10).map(a => ({
          ...a, ocrText: words[a.ocrWordIdx]?.text
        }))
      }, null, 2)
    )

    await Promise.all(
      timings.map(({ wordId, startMs, endMs }) =>
        prisma.wordTiming.upsert({
          where: { wordId },
          create: { wordId, startMs, endMs },
          update: { startMs, endMs },
        })
      )
    )

    return NextResponse.json({
      ok: true,
      wordCount: words.length,
      anchorCount: anchors.length,
      firstAnchor: anchors[0]
        ? { ocrWord: words[anchors[0].ocrWordIdx]?.text, ms: anchors[0].startMs }
        : null,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[autosync] Error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
