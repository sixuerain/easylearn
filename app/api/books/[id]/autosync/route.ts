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

/** CJK bigram set for fuzzy text matching */
function bigrams(s: string): Set<string> {
  const chars = cjkChars(s)
  const bg = new Set<string>()
  for (let i = 0; i + 1 < chars.length; i++) bg.add(chars[i] + chars[i + 1])
  return bg
}

function jaccardSim(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

async function transcribe(audio: Float32Array, language: string): Promise<Chunk[]> {
  const { pipeline, env } = await import('@xenova/transformers')
  env.cacheDir = path.join(process.cwd(), '.whisper_cache')
  const asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base')
  const result = await asr(audio, {
    language,
    task: 'transcribe',
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
  }) as { chunks: Chunk[] }
  return result.chunks ?? []
}

/**
 * Remove duplicate leading word spans from the OCR word list.
 *
 * Books often have the title printed as a heading on the page, then again
 * as the first word(s) of the content.  The audio only reads it once.
 * We scan for the first occurrence of any leading 1–6 word block appearing
 * again within the next 20 words, and remove the first (heading) block.
 */
function deduplicateLeadingWords<T extends { text: string }>(words: T[]): T[] {
  for (let w = 1; w <= 6; w++) {
    if (words.length < w * 2) break
    const block1 = words.slice(0, w).map(x => x.text).join('')
    const limit = Math.min(w * 4 + 1, words.length - w + 1)
    for (let start = w; start < limit; start++) {
      const block2 = words.slice(start, start + w).map(x => x.text).join('')
      if (block1 === block2) {
        console.log(`[autosync] Dedup: removed leading "${block1}" (duplicate at position ${start})`)
        return words.slice(w)
      }
    }
  }
  return words
}

/**
 * Build a Whisper character timeline.
 *
 * Each valid CJK character in a Whisper segment is assigned an interpolated
 * millisecond timestamp.  Synthetic entries are prepended/appended to ensure
 * the timeline covers [0, audioDurationMs].
 */
function buildTimeline(chunks: Chunk[], audioDurationMs: number): number[] {
  const timeline: number[] = []

  for (const c of chunks) {
    const startMs = (c.timestamp[0] as number) * 1000
    const endMs   = (c.timestamp[1] as number) * 1000
    const cjkCount = cjkChars(c.text).length
    const count   = Math.max(1, cjkCount)

    // Skip hallucination chunks:
    //  - fewer than 2 CJK chars
    //  - timestamp gap < 100 ms
    //  - CJK chars are < 25% of total chars (e.g. "!!!!!!!想出鬼寄来" is mostly noise)
    if (cjkCount < 2 || endMs - startMs < 100 || cjkCount < c.text.length * 0.25) continue

    const msPerChar = (endMs - startMs) / count
    for (let i = 0; i < count; i++) {
      timeline.push(startMs + i * msPerChar)
    }
  }

  if (timeline.length === 0) return timeline

  // Prepend synthetic entries to cover [0, firstMs) using early-segment pace.
  const firstMs = timeline[0]
  if (firstMs > 500) {
    const sampleLen = Math.min(50, timeline.length - 1)
    const paceMs = sampleLen > 0
      ? (timeline[sampleLen] - timeline[0]) / sampleLen
      : (timeline[timeline.length - 1] - timeline[0]) / Math.max(1, timeline.length - 1)
    const prependCount = Math.round(firstMs / Math.max(1, paceMs))
    for (let i = prependCount; i >= 1; i--) {
      timeline.unshift(Math.round(firstMs - i * paceMs))
    }
  }

  // Append synthetic entries to cover [lastMs, audioDurationMs) using late-segment pace.
  const lastMs = timeline[timeline.length - 1]
  const tailMs = audioDurationMs - lastMs
  if (tailMs > 500) {
    const sampleStart = Math.max(0, timeline.length - 51)
    const sampleLen = timeline.length - 1 - sampleStart
    const paceMs = sampleLen > 0
      ? (timeline[timeline.length - 1] - timeline[sampleStart]) / sampleLen
      : (timeline[timeline.length - 1] - timeline[0]) / Math.max(1, timeline.length - 1)
    const appendCount = Math.round(tailMs / Math.max(1, paceMs))
    for (let i = 1; i <= appendCount; i++) {
      timeline.push(Math.round(lastMs + i * paceMs))
    }
  }

  return timeline
}

interface Anchor { ocrCumChars: number; ms: number }

/**
 * Match the first `maxAnchors` valid Whisper chunks to their best-fitting
 * position in the OCR word list using CJK bigram Jaccard similarity.
 *
 * Even though Whisper-base Chinese accuracy is low, bigram overlap is enough
 * to identify the rough sentence position.  We search a sliding window of
 * `windowWords` consecutive OCR words against each Whisper chunk text.
 *
 * Returns anchors sorted by ocrCumChars ascending.
 */
function findAnchors(
  chunks: Chunk[],
  words: { text: string }[],
  cumChars: number[],   // cumulative char count BEFORE each word (length = words.length)
  maxAnchors: number,
): Anchor[] {
  const validChunks = chunks.filter(c =>
    cjkChars(c.text).length >= 4 &&
    c.timestamp[0] !== null &&
    c.timestamp[1] !== null &&
    (c.timestamp[1] as number) - (c.timestamp[0] as number) >= 0.2 &&
    cjkChars(c.text).length >= c.text.length * 0.25   // reject hallucinations like "!!!!想出鬼"
  )

  const anchors: Anchor[] = []
  const windowWords = 10
  // Only search first 70% of OCR words (anchors are near the beginning)
  const searchLimit = Math.max(0, Math.floor(words.length * 0.7) - windowWords)

  for (const chunk of validChunks.slice(0, maxAnchors)) {
    const chunkBg = bigrams(chunk.text)
    let bestScore = 0.15  // minimum similarity threshold
    let bestIdx = -1

    for (let i = 0; i <= searchLimit; i++) {
      const windowText = words.slice(i, i + windowWords).map(w => w.text).join('')
      const score = jaccardSim(chunkBg, bigrams(windowText))
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    }

    if (bestIdx >= 0) {
      const ms = Math.round((chunk.timestamp[0] as number) * 1000)
      const ocrCumChars = cumChars[bestIdx]
      anchors.push({ ocrCumChars, ms })
      console.log(
        `[autosync] Anchor: OCR word ${bestIdx} (cumChars ${ocrCumChars}) → ${ms}ms` +
        ` (sim ${bestScore.toFixed(2)}) "${chunk.text.slice(0, 25)}"`
      )
    }
  }

  // Keep anchors sorted and de-duplicate overlaps
  return anchors
    .sort((a, b) => a.ocrCumChars - b.ocrCumChars)
    .filter((a, i, arr) => i === 0 || a.ocrCumChars > arr[i - 1].ocrCumChars)
}

/**
 * Map OCR words to timestamps using anchor-guided piecewise interpolation.
 *
 * Anchors divide the OCR char range into segments.  Within each segment we
 * look up the corresponding slice of the Whisper timeline and map by proportion.
 * Before the first anchor and after the last anchor we extrapolate at the
 * local speaking pace.
 */
function mapWordsToTimeline(
  words: { id: string; text: string }[],
  timeline: number[],
  audioDurationMs: number,
  anchors: Anchor[],
): { wordId: string; startMs: number; endMs: number }[] {

  // Build cumulative char counts
  const charCounts  = words.map(w => Math.max(1, cjkChars(w.text).length))
  const cumChars: number[] = []
  let cum = 0
  for (const cc of charCounts) { cumChars.push(cum); cum += cc }
  const totalOcrChars = cum

  if (timeline.length === 0) {
    // Fallback: pure proportional
    return words.map((w, i) => {
      const startMs = Math.round((cumChars[i] / totalOcrChars) * audioDurationMs)
      const endMs   = Math.max(startMs + 50,
        Math.round(((cumChars[i] + charCounts[i]) / totalOcrChars) * audioDurationMs))
      return { wordId: w.id, startMs, endMs }
    })
  }

  // Build segment boundaries: [(ocrStart, ocrEnd, msStart, msEnd), ...]
  // using anchors as fixed pinned points.
  const tLen = timeline.length
  const msToTIdx = (ms: number) =>
    Math.min(tLen - 1, Math.max(0, Math.round((ms / audioDurationMs) * tLen)))

  // Full segment list: start → anchors → end
  const pins: { ocrChars: number; ms: number }[] = [
    { ocrChars: 0, ms: 0 },
    ...anchors.map(a => ({ ocrChars: a.ocrCumChars, ms: a.ms })),
    { ocrChars: totalOcrChars, ms: audioDurationMs },
  ]

  // For each word, find its segment and interpolate
  const result: { wordId: string; startMs: number; endMs: number }[] = []

  for (let wi = 0; wi < words.length; wi++) {
    const ocrStart = cumChars[wi]
    const ocrEnd   = ocrStart + charCounts[wi]

    // Find surrounding pins
    let seg = pins.length - 2
    for (let pi = 0; pi < pins.length - 1; pi++) {
      if (pins[pi + 1].ocrChars > ocrStart) { seg = pi; break }
    }

    const { ocrChars: segOcrStart, ms: segMsStart } = pins[seg]
    const { ocrChars: segOcrEnd,   ms: segMsEnd   } = pins[seg + 1]

    const segOcrLen = Math.max(1, segOcrEnd   - segOcrStart)
    const segMsLen  = Math.max(1, segMsEnd    - segMsStart)
    const segTStart = msToTIdx(segMsStart)
    const segTEnd   = msToTIdx(segMsEnd)
    const segTLen   = Math.max(1, segTEnd - segTStart)

    const fracStart = (ocrStart - segOcrStart) / segOcrLen
    const fracEnd   = (ocrEnd   - segOcrStart) / segOcrLen

    const tIdxStart = segTStart + fracStart * segTLen
    const tIdxEnd   = segTStart + fracEnd   * segTLen

    const startMs = timeline[Math.min(Math.floor(tIdxStart), tLen - 1)]
    const endMs   = Math.max(startMs + 50,
      timeline[Math.min(Math.floor(tIdxEnd), tLen - 1)])

    result.push({ wordId: words[wi].id, startMs: Math.round(startMs), endMs: Math.round(endMs) })
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
  const rawWords = pages.flatMap(p => p.words)
  if (rawWords.length === 0) {
    return NextResponse.json({ error: 'No words found. Run OCR on pages first.' }, { status: 400 })
  }

  // Remove duplicate leading title/header words from OCR list
  const words = deduplicateLeadingWords(rawWords)
  if (words.length < rawWords.length) {
    console.log(`[autosync] Removed ${rawWords.length - words.length} duplicate leading words`)
  }

  try {
    console.log('[autosync] Decoding audio…')
    const audio = await decodeAudio(audioPath)
    const audioDurationMs = Math.round((audio.length / 16000) * 1000)

    const lang = LANG_MAP[book.language ?? 'zh'] ?? 'chinese'
    const chunks = await transcribe(audio, lang)

    console.log(`[autosync] ${chunks.length} total segments`)
    chunks.slice(0, 8).forEach((c, i) =>
      console.log(`  [${i}] ${c.timestamp[0]}s-${c.timestamp[1]}s  "${c.text.slice(0, 40)}"`)
    )

    const rawFirstSec = chunks.find(c => cjkChars(c.text).length >= 2)?.timestamp[0] ?? 0
    const timeline = buildTimeline(chunks, audioDurationMs)
    console.log(
      `[autosync] Whisper first valid segment at ${Math.round((rawFirstSec as number) * 1000)}ms,` +
      ` extended timeline: ${timeline[0] ?? 0}ms–${timeline[timeline.length - 1] ?? 0}ms (${timeline.length} chars)`
    )

    // Build cumulative char offsets for OCR words (needed for anchor search)
    const cumChars: number[] = []
    let cumC = 0
    for (const w of words) { cumChars.push(cumC); cumC += Math.max(1, cjkChars(w.text).length) }

    // Find anchor points using first 2 Whisper sentences
    const anchors = findAnchors(chunks, words, cumChars, 2)

    const timings = mapWordsToTimeline(words, timeline, audioDurationMs, anchors)

    // Debug: save transcript + sample timings
    const transcriptDir = path.join(process.cwd(), 'storage', 'transcripts')
    mkdirSync(transcriptDir, { recursive: true })
    writeFileSync(
      path.join(transcriptDir, `${bookId}.json`),
      JSON.stringify({
        audioDurationMs,
        timelineLength: timeline.length,
        anchors,
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
      anchors,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[autosync] Error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
