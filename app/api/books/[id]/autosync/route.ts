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
interface TranscriptChar { char: string; startMs: number; endMs: number }

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/
const cjkChars = (s: string) => [...s].filter(c => CJK_RE.test(c))

function bigramsOf(s: string): Set<string> {
  const bg = new Set<string>()
  for (let i = 0; i + 1 < s.length; i++) bg.add(s[i] + s[i + 1])
  return bg
}

function jaccardSim(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

/**
 * Try word-level timestamps first (gives per-character for CJK).
 * Fall back to chunk-level if word-level fails or returns no data.
 */
async function transcribe(audio: Float32Array, language: string): Promise<{ chunks: Chunk[]; wordLevel: boolean }> {
  const { pipeline, env } = await import('@xenova/transformers')
  env.cacheDir = path.join(process.cwd(), '.whisper_cache')
  const asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base')

  // Try word-level timestamps (per-character for CJK)
  try {
    const result = await asr(audio, {
      language,
      task: 'transcribe',
      return_timestamps: 'word',
    }) as { chunks: Chunk[] }
    const chunks = result.chunks ?? []
    if (chunks.length > 0 && chunks.some(c => c.timestamp[0] != null && c.timestamp[1] != null && c.timestamp[0] !== c.timestamp[1])) {
      console.log(`[autosync] Word-level timestamps: ${chunks.length} entries`)
      return { chunks, wordLevel: true }
    }
    console.log('[autosync] Word-level timestamps returned no usable data, falling back to chunk-level')
  } catch (err) {
    console.log('[autosync] Word-level timestamps failed, falling back to chunk-level:', err)
  }

  // Fallback: chunk-level timestamps with chunked processing
  const result = await asr(audio, {
    language,
    task: 'transcribe',
    return_timestamps: true,
    chunk_length_s: 10,
    stride_length_s: 2,
  }) as { chunks: Chunk[] }
  return { chunks: result.chunks ?? [], wordLevel: false }
}

// ── Stage 1: Whisper → per-character timeline ────────────────────────────────

/**
 * Deduplicate overlapping Whisper chunks from chunked processing.
 */
function deduplicateChunks(chunks: Chunk[]): Chunk[] {
  const valid = chunks.filter(c => c.timestamp[0] != null && c.timestamp[1] != null)
  if (valid.length === 0) return valid

  const result: Chunk[] = [valid[0]]
  for (let i = 1; i < valid.length; i++) {
    const prev = result[result.length - 1]
    const curr = valid[i]
    const prevCjk = cjkChars(prev.text).join('')
    const currCjk = cjkChars(curr.text).join('')

    // Find longest suffix of prevCjk that is a prefix of currCjk
    let overlap = 0
    const maxCheck = Math.min(prevCjk.length, currCjk.length)
    for (let len = 1; len <= maxCheck; len++) {
      if (prevCjk.endsWith(currCjk.slice(0, len))) overlap = len
    }

    // Check for hallucinated near-duplicate chunks
    if (overlap === 0 && currCjk.length >= 4 && prevCjk.length >= 4) {
      const sim = jaccardSim(bigramsOf(prevCjk), bigramsOf(currCjk))
      if (sim > 0.6) {
        console.log(`[autosync] Dropping hallucinated chunk [${i}] sim=${sim.toFixed(2)}`)
        continue
      }
    }

    if (overlap > 0) {
      const currChars = cjkChars(curr.text)
      const startMs = curr.timestamp[0]! * 1000
      const endMs = curr.timestamp[1]! * 1000
      const msPerChar = currChars.length > 0 ? (endMs - startMs) / currChars.length : 0
      const newStartMs = startMs + overlap * msPerChar
      const remaining = currChars.slice(overlap).join('')
      if (remaining.length > 0) {
        result.push({ text: remaining, timestamp: [newStartMs / 1000, curr.timestamp[1]!] })
      }
    } else {
      result.push(curr)
    }
  }
  console.log(`[autosync] Chunk dedup: ${valid.length} → ${result.length} chunks`)
  return result
}

/**
 * Stage 1: Build per-CJK-character timeline from Whisper output.
 *
 * Word-level mode: each chunk is already a single word/character with its own timestamp.
 * Chunk-level mode: each chunk is a phrase; timestamps are interpolated across characters.
 */
function buildTranscriptChars(chunks: Chunk[], wordLevel: boolean): TranscriptChar[] {
  if (wordLevel) {
    // Word-level: each chunk is one word/character with real timestamps
    const result: TranscriptChar[] = []
    for (let ci = 0; ci < chunks.length; ci++) {
      const c = chunks[ci]
      // Extrapolate null timestamps from previous chunk's end
      if (c.timestamp[0] == null || c.timestamp[1] == null) {
        if (result.length === 0) continue
        const lastEnd = result[result.length - 1].endMs
        const chars = cjkChars(c.text)
        if (chars.length === 0) continue
        const msPerChar = 350 // ~350ms per CJK char as fallback pace
        for (let i = 0; i < chars.length; i++) {
          result.push({
            char: chars[i],
            startMs: lastEnd + i * msPerChar,
            endMs: lastEnd + (i + 1) * msPerChar,
          })
        }
        console.log(`[autosync] Extrapolated ${chars.length} chars from null-timestamp chunk [${ci}]`)
        continue
      }
      const startMs = Math.round(c.timestamp[0] * 1000)
      const endMs = Math.round(c.timestamp[1] * 1000)
      if (endMs <= startMs) continue
      const chars = cjkChars(c.text)
      if (chars.length === 0) continue
      if (chars.length === 1) {
        result.push({ char: chars[0], startMs, endMs })
      } else {
        // Multi-char word: distribute timing within this word
        const msPerChar = (endMs - startMs) / chars.length
        for (let i = 0; i < chars.length; i++) {
          result.push({
            char: chars[i],
            startMs: Math.round(startMs + i * msPerChar),
            endMs: Math.round(startMs + (i + 1) * msPerChar),
          })
        }
      }
    }
    return result
  }

  // Chunk-level: deduplicate then interpolate
  const deduped = deduplicateChunks(chunks)
  const result: TranscriptChar[] = []
  for (const c of deduped) {
    if (c.timestamp[0] == null || c.timestamp[1] == null) {
      // Extrapolate from previous chunk's end
      if (result.length === 0) continue
      const lastEnd = result[result.length - 1].endMs
      const chars = cjkChars(c.text)
      if (chars.length === 0) continue
      const msPerChar = 350
      for (let i = 0; i < chars.length; i++) {
        result.push({
          char: chars[i],
          startMs: lastEnd + i * msPerChar,
          endMs: lastEnd + (i + 1) * msPerChar,
        })
      }
      console.log(`[autosync] Extrapolated ${chars.length} chars from null-timestamp chunk`)
      continue
    }
    const startMs = c.timestamp[0] * 1000
    const endMs = c.timestamp[1] * 1000
    if (endMs - startMs < 50) continue
    const chars = cjkChars(c.text)
    if (chars.length === 0) continue
    const msPerChar = (endMs - startMs) / chars.length
    for (let i = 0; i < chars.length; i++) {
      const cs = Math.round(startMs + i * msPerChar)
      const ce = Math.round(startMs + (i + 1) * msPerChar)
      result.push({ char: chars[i], startMs: cs, endMs: ce })
    }
  }
  return result
}

// ── Stage 2: Edit-distance alignment of transcript chars ↔ OCR chars ─────────

interface AlignResult {
  transcriptIdx: number  // index into TranscriptChar[]
  ocrWordId: string      // matched OCR Word id
  confidence: number     // 1.0 = exact match, 0.5 = substitution
}

/**
 * Align two character sequences using Wagner-Fischer edit distance with backtracking.
 * Returns pairs of (transcriptIdx, ocrIdx) for matched characters.
 */
function editDistanceAlign(whisperChars: string[], ocrChars: string[]): Array<[number, number, number]> {
  const n = whisperChars.length
  const m = ocrChars.length
  if (n === 0 || m === 0) return []

  // DP table: dp[i][j] = min edit distance for whisper[0..i-1] vs ocr[0..j-1]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 0; i <= n; i++) dp[i][0] = i
  for (let j = 0; j <= m; j++) dp[0][j] = j

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = whisperChars[i - 1] === ocrChars[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,     // delete (whisper char has no OCR match)
        dp[i][j - 1] + 1,     // insert (OCR char has no whisper match)
        dp[i - 1][j - 1] + cost // match or substitute
      )
    }
  }

  // Backtrack to find alignment
  const pairs: Array<[number, number, number]> = [] // [whisperIdx, ocrIdx, confidence]
  let i = n, j = m
  while (i > 0 && j > 0) {
    const cost = whisperChars[i - 1] === ocrChars[j - 1] ? 0 : 1
    if (dp[i][j] === dp[i - 1][j - 1] + cost) {
      // Match or substitution — link them
      pairs.push([i - 1, j - 1, cost === 0 ? 1.0 : 0.5])
      i--; j--
    } else if (dp[i][j] === dp[i - 1][j] + 1) {
      i-- // whisper char unmatched (insertion in whisper)
    } else {
      j-- // OCR char unmatched (insertion in OCR)
    }
  }

  pairs.reverse()
  return pairs
}

/**
 * Stage 2: For each page, align transcript chars with OCR chars using edit distance.
 * Assigns pageId and ocrWordId to transcript chars.
 */
function alignTranscriptToOcr(
  transcriptChars: TranscriptChar[],
  pages: Array<{ id: string; words: Array<{ id: string; text: string; orderIdx: number }> }>
): { pageAssignments: Map<number, string>; ocrMatches: AlignResult[] } {
  // Build a flat list of OCR chars with their word IDs, grouped by page
  const pageOcrChars: Array<{
    pageId: string
    chars: Array<{ char: string; wordId: string }>
  }> = pages.map(p => ({
    pageId: p.id,
    chars: p.words.flatMap(w =>
      cjkChars(w.text).map(c => ({ char: c, wordId: w.id }))
    ),
  }))

  // Concatenate all OCR chars across pages, keeping page boundaries
  const allOcrChars: Array<{ char: string; wordId: string; pageId: string }> = []
  for (const p of pageOcrChars) {
    for (const c of p.chars) {
      allOcrChars.push({ ...c, pageId: p.pageId })
    }
  }

  const whisperChars = transcriptChars.map(tc => tc.char)
  const ocrCharTexts = allOcrChars.map(c => c.char)

  console.log(`[autosync] Aligning ${whisperChars.length} Whisper chars ↔ ${ocrCharTexts.length} OCR chars`)

  const pairs = editDistanceAlign(whisperChars, ocrCharTexts)
  console.log(`[autosync] Edit distance: ${pairs.length} matched pairs`)

  const pageAssignments = new Map<number, string>()
  const ocrMatches: AlignResult[] = []

  for (const [wi, oi, conf] of pairs) {
    const ocrEntry = allOcrChars[oi]
    pageAssignments.set(wi, ocrEntry.pageId)
    ocrMatches.push({
      transcriptIdx: wi,
      ocrWordId: ocrEntry.wordId,
      confidence: conf,
    })
  }

  // For unmatched transcript chars, assign page by interpolation from neighbors
  let lastPageId = pages[0]?.id ?? null
  for (let i = 0; i < transcriptChars.length; i++) {
    if (pageAssignments.has(i)) {
      lastPageId = pageAssignments.get(i)!
    } else if (lastPageId) {
      pageAssignments.set(i, lastPageId)
    }
  }

  return { pageAssignments, ocrMatches }
}

// ── Route handler ────────────────────────────────────────────────────────────

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
  if (pages.flatMap(p => p.words).length === 0) {
    return NextResponse.json({ error: 'No words found. Run OCR on pages first.' }, { status: 400 })
  }

  try {
    console.log('[autosync] Decoding audio…')
    const audio = await decodeAudio(audioPath)
    const audioDurationMs = Math.round((audio.length / 16000) * 1000)

    const lang = LANG_MAP[book.language ?? 'zh'] ?? 'chinese'
    const { chunks, wordLevel } = await transcribe(audio, lang)
    console.log(`[autosync] ${chunks.length} Whisper segments (${wordLevel ? 'word-level' : 'chunk-level'})`)

    // ── Stage 1: Build transcript character timeline ──
    const transcriptChars = buildTranscriptChars(chunks, wordLevel)
    console.log(`[autosync] Stage 1: ${transcriptChars.length} transcript chars, ` +
      `${transcriptChars[0]?.startMs ?? 0}ms – ${transcriptChars[transcriptChars.length - 1]?.endMs ?? 0}ms`)

    // ── Stage 2: Align transcript ↔ OCR via edit distance ──
    const { pageAssignments, ocrMatches } = alignTranscriptToOcr(transcriptChars, pages)

    const matchedCount = ocrMatches.length
    const exactCount = ocrMatches.filter(m => m.confidence === 1.0).length
    console.log(`[autosync] Stage 2: ${matchedCount} matched (${exactCount} exact), ` +
      `${transcriptChars.length - matchedCount} unmatched transcript chars`)

    // Build ocrWordId lookup: transcriptIdx → { ocrWordId, confidence }
    const ocrMatchMap = new Map(ocrMatches.map(m => [m.transcriptIdx, m]))

    // ── Save to DB ──
    // Delete old transcript words for this book
    await prisma.transcriptWord.deleteMany({ where: { bookId } })

    // Create new transcript words
    const transcriptWords = transcriptChars.map((tc, idx) => {
      const match = ocrMatchMap.get(idx)
      return {
        bookId,
        pageId: pageAssignments.get(idx) ?? null,
        text: tc.char,
        startMs: tc.startMs,
        endMs: tc.endMs,
        orderIdx: idx,
        ocrWordId: match?.ocrWordId ?? null,
        matchConf: match?.confidence ?? null,
      }
    })

    // Batch create
    await prisma.transcriptWord.createMany({ data: transcriptWords })

    // Also update legacy WordTiming for backward compat with manual sync
    // Group transcript words by ocrWordId, use first/last timing
    const ocrWordTimings = new Map<string, { startMs: number; endMs: number }>()
    for (const tw of transcriptWords) {
      if (!tw.ocrWordId) continue
      const existing = ocrWordTimings.get(tw.ocrWordId)
      if (!existing) {
        ocrWordTimings.set(tw.ocrWordId, { startMs: tw.startMs, endMs: tw.endMs })
      } else {
        existing.startMs = Math.min(existing.startMs, tw.startMs)
        existing.endMs = Math.max(existing.endMs, tw.endMs)
      }
    }
    await Promise.all(
      [...ocrWordTimings.entries()].map(([wordId, { startMs, endMs }]) =>
        prisma.wordTiming.upsert({
          where: { wordId },
          create: { wordId, startMs, endMs },
          update: { startMs, endMs },
        })
      )
    )

    // ── Debug output ──
    const transcriptDir = path.join(process.cwd(), 'storage', 'transcripts')
    mkdirSync(transcriptDir, { recursive: true })

    const lines: string[] = []
    lines.push(`=== AUTOSYNC v2 DEBUG: ${bookId} ===`)
    lines.push(`Audio: ${(audioDurationMs / 1000).toFixed(1)}s | Title: "${book.title}"`)
    lines.push(`Timestamp mode: ${wordLevel ? 'word-level (per-character)' : 'chunk-level (interpolated)'}`)
    lines.push(`Whisper chunks: ${chunks.length} → ${transcriptChars.length} CJK chars${wordLevel ? '' : ' (after dedup)'}`)
    lines.push(`OCR chars: ${pages.flatMap(p => p.words).flatMap(w => cjkChars(w.text)).length}`)
    lines.push(`Matched: ${matchedCount} (${exactCount} exact, ${matchedCount - exactCount} substitution)`)
    lines.push(`Unmatched transcript chars: ${transcriptChars.length - matchedCount}`)
    lines.push('')
    lines.push('--- TRANSCRIPT TIMELINE ---')
    for (let i = 0; i < transcriptWords.length; i++) {
      const tw = transcriptWords[i]
      const match = ocrMatchMap.get(i)
      const matchInfo = match ? ` → OCR "${tw.ocrWordId?.slice(0, 8)}" conf=${match.confidence}` : ' [no OCR match]'
      lines.push(`  [${String(i).padStart(3)}] ${(tw.startMs / 1000).toFixed(2).padStart(7)}s – ${(tw.endMs / 1000).toFixed(2).padStart(7)}s  "${tw.text}"${matchInfo}`)
    }
    lines.push('')
    lines.push('--- WHISPER SEGMENTS (raw) ---')
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]
      lines.push(`  [${String(i).padStart(3)}] ${c.timestamp[0]}s–${c.timestamp[1]}s  "${c.text.slice(0, 70)}"`)
    }

    writeFileSync(path.join(transcriptDir, `${bookId}.txt`), lines.join('\n'))
    writeFileSync(path.join(transcriptDir, `${bookId}.json`), JSON.stringify({
      version: 2,
      wordLevel,
      audioDurationMs,
      transcriptChars: transcriptChars.length,
      ocrChars: pages.flatMap(p => p.words).flatMap(w => cjkChars(w.text)).length,
      matched: matchedCount,
      exact: exactCount,
      transcript: transcriptWords.map(tw => ({
        text: tw.text,
        startSec: +(tw.startMs / 1000).toFixed(2),
        endSec: +(tw.endMs / 1000).toFixed(2),
        ocrWordId: tw.ocrWordId,
        matchConf: tw.matchConf,
      })),
    }, null, 2))

    return NextResponse.json({
      ok: true,
      version: 2,
      wordLevel,
      transcriptChars: transcriptChars.length,
      matched: matchedCount,
      exact: exactCount,
      unmatched: transcriptChars.length - matchedCount,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[autosync] Error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
