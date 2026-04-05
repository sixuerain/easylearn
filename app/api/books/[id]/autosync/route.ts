import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLocalAudioPath } from '@/lib/audio'
import path from 'path'
import { readFileSync } from 'fs'

const LANG_MAP: Record<string, string> = {
  zh: 'chinese', ja: 'japanese', ko: 'korean',
  en: 'english', es: 'spanish', fr: 'french',
}

/** Decode MP3 to mono Float32Array at 16kHz using node-web-audio-api */
async function decodeAudio(filePath: string): Promise<Float32Array> {
  const { AudioContext } = await import('node-web-audio-api')
  const ctx = new AudioContext({ sampleRate: 16000 })
  const buf = readFileSync(filePath)
  const decoded = await ctx.decodeAudioData(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  const audio = decoded.getChannelData(0)
  await ctx.close()
  return audio
}

interface Chunk { text: string; timestamp: [number, number] }

/** Run Whisper on the audio, return segments with [startS, endS] timestamps */
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

/** Keep only CJK + basic latin characters for alignment counting */
const chineseChars = (s: string) =>
  [...s].filter(c => /[\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{2a6df}]/u.test(c))

/**
 * Align OCR words to Whisper segment timestamps.
 *
 * Strategy:
 *   1. Count Chinese characters in Whisper chunks → cumulative Whisper position
 *   2. Count Chinese characters in OCR words → cumulative OCR position
 *   3. Map each OCR char position proportionally to the Whisper char timeline
 *   4. Interpolate within the Whisper segment to get ms timestamp
 *
 * This is robust to traditional/simplified differences and minor misrecognitions
 * because it matches by character COUNT proportion, not character identity.
 */
function alignWordsToChunks(
  ocrWords: { id: string; text: string }[],
  chunks: Chunk[],
): { wordId: string; startMs: number; endMs: number }[] {
  const ocrCounts  = ocrWords.map(w => Math.max(1, chineseChars(w.text).length))
  const chunkCounts = chunks.map(c => Math.max(1, chineseChars(c.text).length))

  const totalOcr     = ocrCounts.reduce((a, b) => a + b, 0)
  const totalWhisper = chunkCounts.reduce((a, b) => a + b, 0)

  /** Given a cumulative Whisper-char position, return the ms timestamp */
  function whisperPosToMs(pos: number): number {
    let cum = 0
    for (let i = 0; i < chunks.length; i++) {
      const next = cum + chunkCounts[i]
      const c = chunks[i]
      if (pos <= next || i === chunks.length - 1) {
        const frac = chunkCounts[i] > 0 ? Math.min(1, (pos - cum) / chunkCounts[i]) : 0
        return Math.round((c.timestamp[0] + frac * (c.timestamp[1] - c.timestamp[0])) * 1000)
      }
      cum = next
    }
    return Math.round(chunks[chunks.length - 1].timestamp[1] * 1000)
  }

  const result: { wordId: string; startMs: number; endMs: number }[] = []
  let ocrCum = 0

  for (let i = 0; i < ocrWords.length; i++) {
    const wordStartOcr = ocrCum
    const wordEndOcr   = ocrCum + ocrCounts[i]

    const wStart = (wordStartOcr / totalOcr) * totalWhisper
    const wEnd   = (wordEndOcr   / totalOcr) * totalWhisper

    const startMs = whisperPosToMs(wStart)
    const endMs   = Math.max(startMs + 50, whisperPosToMs(wEnd))

    result.push({ wordId: ocrWords[i].id, startMs, endMs })
    ocrCum = wordEndOcr
  }

  return result
}

/**
 * POST /api/books/[id]/autosync
 * Transcribes the local audio with Whisper, then maps OCR word timings using
 * segment-level anchors. Much more accurate than uniform proportional distribution.
 */
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

    const lang = LANG_MAP[book.language ?? 'zh'] ?? 'chinese'
    console.log(`[autosync] Transcribing ${(audio.length / 16000).toFixed(1)}s of audio (language: ${lang})…`)
    const chunks = await transcribe(audio, lang)
    console.log(`[autosync] Got ${chunks.length} segments`)

    const timings = alignWordsToChunks(words, chunks)

    await Promise.all(
      timings.map(({ wordId, startMs, endMs }) =>
        prisma.wordTiming.upsert({
          where: { wordId },
          create: { wordId, startMs, endMs },
          update: { startMs, endMs },
        })
      )
    )

    return NextResponse.json({ ok: true, wordCount: words.length, segmentCount: chunks.length })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[autosync] Error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
