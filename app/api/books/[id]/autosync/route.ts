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

/** Keep only CJK characters for alignment counting */
const cjkChars = (s: string) =>
  [...s].filter(c => /[\u4e00-\u9fff\u3400-\u4dbf]/u.test(c))

/**
 * Find the index of the first Whisper chunk that best matches the first OCR sentence.
 * This handles audio that starts with a title or intro not present in OCR pages.
 *
 * Strategy: slide through Whisper chunks and find the one whose text has the most
 * character overlap with the first OCR text.
 */
function findAudioStartChunk(chunks: Chunk[], firstOcrText: string): number {
  const ocrChars = new Set(cjkChars(firstOcrText))
  let bestIdx = 0
  let bestScore = -1

  for (let i = 0; i < Math.min(chunks.length, 20); i++) {
    const whisperChars = cjkChars(chunks[i].text)
    const overlap = whisperChars.filter(c => ocrChars.has(c)).length
    const score = overlap / Math.max(1, ocrChars.size)
    if (score > bestScore) {
      bestScore = score
      bestIdx = i
    }
    // Good enough match
    if (score > 0.5) break
  }

  return bestIdx
}

/**
 * Align OCR words to Whisper segment timestamps.
 *
 * Maps OCR character positions proportionally to Whisper character positions,
 * using segment boundaries as time anchors. Starts from `startChunkIdx` to
 * skip audio intro/title not present in the OCR.
 */
function alignWordsToChunks(
  ocrWords: { id: string; text: string }[],
  chunks: Chunk[],
  startChunkIdx: number,
): { wordId: string; startMs: number; endMs: number }[] {
  const activeChunks = chunks.slice(startChunkIdx)

  const ocrCounts   = ocrWords.map(w => Math.max(1, cjkChars(w.text).length))
  const chunkCounts = activeChunks.map(c => Math.max(1, cjkChars(c.text).length))

  const totalOcr     = ocrCounts.reduce((a, b) => a + b, 0)
  const totalWhisper = chunkCounts.reduce((a, b) => a + b, 0)

  function whisperPosToMs(pos: number): number {
    let cum = 0
    for (let i = 0; i < activeChunks.length; i++) {
      const next = cum + chunkCounts[i]
      const c = activeChunks[i]
      if (pos <= next || i === activeChunks.length - 1) {
        const frac = chunkCounts[i] > 0 ? Math.min(1, (pos - cum) / chunkCounts[i]) : 0
        return Math.round((c.timestamp[0] + frac * (c.timestamp[1] - c.timestamp[0])) * 1000)
      }
      cum = next
    }
    return Math.round(activeChunks[activeChunks.length - 1].timestamp[1] * 1000)
  }

  const result: { wordId: string; startMs: number; endMs: number }[] = []
  let ocrCum = 0

  for (let i = 0; i < ocrWords.length; i++) {
    const wStart = (ocrCum / totalOcr) * totalWhisper
    const wEnd   = ((ocrCum + ocrCounts[i]) / totalOcr) * totalWhisper

    const startMs = whisperPosToMs(wStart)
    const endMs   = Math.max(startMs + 50, whisperPosToMs(wEnd))

    result.push({ wordId: ocrWords[i].id, startMs, endMs })
    ocrCum += ocrCounts[i]
  }

  return result
}

/**
 * POST /api/books/[id]/autosync
 * Transcribes local audio with Whisper, saves transcript to storage/transcripts/,
 * finds where OCR text begins in the audio, then maps word timings using
 * Whisper segment anchors.
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
    console.log(`[autosync] Transcribing ${(audio.length / 16000).toFixed(1)}s (language: ${lang})…`)
    const chunks = await transcribe(audio, lang)
    console.log(`[autosync] Got ${chunks.length} segments`)

    // Save transcript to storage/transcripts/{bookId}.json for debugging
    const transcriptDir = path.join(process.cwd(), 'storage', 'transcripts')
    mkdirSync(transcriptDir, { recursive: true })
    const transcriptPath = path.join(transcriptDir, `${bookId}.json`)
    const firstOcrWords = words.slice(0, 10).map(w => w.text).join('')
    const startChunkIdx = findAudioStartChunk(chunks, firstOcrWords)

    const debugPayload = {
      bookId,
      bookTitle: book.title,
      language: lang,
      audioDurationS: audio.length / 16000,
      segmentCount: chunks.length,
      firstOcrWords,
      detectedAudioStartChunk: startChunkIdx,
      detectedAudioStartTime: chunks[startChunkIdx]?.timestamp[0],
      chunks,
    }
    writeFileSync(transcriptPath, JSON.stringify(debugPayload, null, 2))
    console.log(`[autosync] Transcript saved to ${transcriptPath}`)
    console.log(`[autosync] OCR starts at chunk ${startChunkIdx}: "${chunks[startChunkIdx]?.text}" @ ${chunks[startChunkIdx]?.timestamp[0]}s`)

    const timings = alignWordsToChunks(words, chunks, startChunkIdx)

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
      audioStartChunk: startChunkIdx,
      audioStartTime: chunks[startChunkIdx]?.timestamp[0],
      audioStartText: chunks[startChunkIdx]?.text,
      transcriptSaved: transcriptPath,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[autosync] Error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
