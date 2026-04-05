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
  const decoded = await ctx.decodeAudioData(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  )
  const audio = decoded.getChannelData(0)
  await ctx.close()
  return audio
}

interface Chunk { text: string; timestamp: [number | null, number | null] }

/** Extract CJK characters only */
const cjkChars = (s: string) =>
  [...s].filter(c => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(c))

/**
 * Two-pass Whisper transcription.
 *
 * The full-audio pass often misses the first 20-30 seconds (music intro causes
 * hallucination).  Running a separate short pass on the first 30 s recovers
 * those segments.  We merge the two result sets, deduplicating by timestamp.
 */
async function transcribeTwoPass(audio: Float32Array, language: string): Promise<Chunk[]> {
  const { pipeline } = await import('@xenova/transformers')
  const asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base', {
    cache_dir: path.join(process.cwd(), '.whisper_cache'),
  })

  const opts = {
    language,
    task: 'transcribe' as const,
    return_timestamps: true as const,
    chunk_length_s: 30,
    stride_length_s: 5,
  }

  // Pass 1: full audio
  console.log('[autosync] Whisper pass 1 (full audio)…')
  const full = (await asr(audio, opts)) as { chunks: Chunk[] }

  // Pass 2: first 30 s (captures title / intro that full-audio pass misses)
  console.log('[autosync] Whisper pass 2 (first 30 s)…')
  const short = (await asr(audio.slice(0, 30 * 16000), { ...opts, chunk_length_s: 30 })) as { chunks: Chunk[] }

  // Merge: keep short-pass chunks whose end time < 26 s (before full-pass coverage)
  // and all full-pass chunks with valid timestamps
  const shortChunks = (short.chunks ?? []).filter(c => (c.timestamp[1] ?? 0) < 26)
  const fullChunks  = (full.chunks  ?? []).filter(c => c.timestamp[0] !== null && c.timestamp[1] !== null)

  // Sort by start time
  const merged = [...shortChunks, ...fullChunks].sort(
    (a, b) => (a.timestamp[0] ?? 0) - (b.timestamp[0] ?? 0)
  )

  return merged
}

/**
 * Build a Whisper character timeline.
 *
 * Each valid CJK character in the Whisper output is assigned an interpolated
 * millisecond timestamp based on the segment it belongs to.
 *
 * KEY INSIGHT: we do NOT use the Whisper TEXT for matching — only its TIMING.
 * Whisper-base Chinese accuracy is too low to rely on for text matching.
 * Instead, the character count per segment tells us the speaking PACE, which
 * we use to distribute OCR word timings proportionally.
 */
function buildTimeline(chunks: Chunk[]): number[] {
  const timeline: number[] = []

  for (const c of chunks) {
    const startMs = (c.timestamp[0] as number) * 1000
    const endMs   = (c.timestamp[1] as number) * 1000
    const count   = Math.max(1, cjkChars(c.text).length)

    // Skip hallucination chunks (< 2 CJK chars or timestamp gap < 100 ms)
    if (cjkChars(c.text).length < 2 || endMs - startMs < 100) continue

    const msPerChar = (endMs - startMs) / count
    for (let i = 0; i < count; i++) {
      timeline.push(startMs + i * msPerChar)
    }
  }

  return timeline
}

/**
 * Map OCR words onto the Whisper timeline purely by position proportion.
 *
 * OCR word at cumulative char position p / totalOcrChars
 *   → Whisper timeline position p / totalOcrChars × timelineLength
 *   → interpolated timestamp in ms
 *
 * This gives accurate relative timing even when Whisper's text is wrong,
 * because the pace/duration per segment is still correct.
 */
function mapWordsToTimeline(
  words: { id: string; text: string }[],
  timeline: number[],
  audioDurationMs: number,
): { wordId: string; startMs: number; endMs: number }[] {

  if (timeline.length === 0) {
    // Fallback: pure proportional across full audio
    const charCounts = words.map(w => Math.max(1, cjkChars(w.text).length))
    const total = charCounts.reduce((a, b) => a + b, 0)
    let cum = 0
    return words.map((w, i) => {
      const startMs = Math.round((cum / total) * audioDurationMs)
      cum += charCounts[i]
      const endMs = Math.max(startMs + 50, Math.round((cum / total) * audioDurationMs))
      return { wordId: w.id, startMs, endMs }
    })
  }

  const charCounts   = words.map(w => Math.max(1, cjkChars(w.text).length))
  const totalOcrChars = charCounts.reduce((a, b) => a + b, 0)
  const tLen = timeline.length

  const result: { wordId: string; startMs: number; endMs: number }[] = []
  let ocrCum = 0

  for (let i = 0; i < words.length; i++) {
    const wStart = (ocrCum / totalOcrChars) * tLen
    const wEnd   = ((ocrCum + charCounts[i]) / totalOcrChars) * tLen

    const startMs = timeline[Math.min(Math.floor(wStart), tLen - 1)]
    const endMs   = Math.max(
      startMs + 50,
      timeline[Math.min(Math.floor(wEnd), tLen - 1)]
    )

    result.push({ wordId: words[i].id, startMs: Math.round(startMs), endMs: Math.round(endMs) })
    ocrCum += charCounts[i]
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
    const chunks = await transcribeTwoPass(audio, lang)

    console.log(`[autosync] ${chunks.length} total segments after merge`)
    chunks.slice(0, 8).forEach((c, i) =>
      console.log(`  [${i}] ${c.timestamp[0]}s-${c.timestamp[1]}s  "${c.text.slice(0, 40)}"`)
    )

    const timeline = buildTimeline(chunks)
    console.log(`[autosync] Timeline has ${timeline.length} chars, spanning ${timeline[0] ?? 0}ms–${timeline[timeline.length - 1] ?? 0}ms`)

    const timings = mapWordsToTimeline(words, timeline, audioDurationMs)

    // Debug: save transcript + sample timings
    const transcriptDir = path.join(process.cwd(), 'storage', 'transcripts')
    mkdirSync(transcriptDir, { recursive: true })
    writeFileSync(
      path.join(transcriptDir, `${bookId}.json`),
      JSON.stringify({
        audioDurationMs,
        timelineLength: timeline.length,
        chunks,
        timingSample: timings.slice(0, 20).map((t, i) => ({
          word: words[i]?.text,
          startMs: t.startMs,
          endMs: t.endMs,
        })),
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
      segmentCount: chunks.length,
      timelineChars: timeline.length,
      timelineStartMs: timeline[0] ?? 0,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[autosync] Error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
