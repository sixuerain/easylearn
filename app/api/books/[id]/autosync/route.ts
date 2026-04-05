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
interface CharMs { char: string; ms: number }
interface Anchor { ocrPos: number; whisperPos: number; score: number }

const cjkChars = (s: string) =>
  [...s].filter(c => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(c))
const cjkText = (s: string) => cjkChars(s).join('')

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

async function transcribe(audio: Float32Array, language: string): Promise<Chunk[]> {
  const { pipeline, env } = await import('@xenova/transformers')
  env.cacheDir = path.join(process.cwd(), '.whisper_cache')
  const asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base')
  // Shorter chunks (10s) give much better timestamp resolution than 30s,
  // especially when there's background music confusing the attention.
  const result = await asr(audio, {
    language,
    task: 'transcribe',
    return_timestamps: true,
    chunk_length_s: 10,
    stride_length_s: 2,
  }) as { chunks: Chunk[] }
  return result.chunks ?? []
}

/**
 * Detect when actual speech/audio starts by finding the first sustained
 * energy above the noise floor.  Returns ms.
 */
function detectAudioOnset(audio: Float32Array, sampleRate: number): number {
  const frameSize = Math.floor(sampleRate * 0.05) // 50ms frames
  const numFrames = Math.floor(audio.length / frameSize)

  const rms: number[] = []
  for (let f = 0; f < numFrames; f++) {
    let sum = 0
    const off = f * frameSize
    for (let i = off; i < off + frameSize; i++) sum += audio[i] * audio[i]
    rms.push(Math.sqrt(sum / frameSize))
  }

  // Noise floor = 10th percentile of first 2 seconds
  const first2s = rms.slice(0, Math.floor(2000 / 50))
  const sorted = [...first2s].sort((a, b) => a - b)
  const noiseFloor = Math.max(0.0001, sorted[Math.floor(sorted.length * 0.1)] ?? 0.0001)

  // First sustained activity: 3+ consecutive frames above 5× noise floor
  const threshold = noiseFloor * 5
  for (let i = 0; i < rms.length - 3; i++) {
    if (rms[i] > threshold && rms[i + 1] > threshold && rms[i + 2] > threshold) {
      return i * 50
    }
  }
  return 0
}

/**
 * Detect speech onset using energy variance (speech has higher variance
 * than music because of pauses/consonants). Returns ms.
 */
function detectSpeechOnset(audio: Float32Array, sampleRate: number): number {
  const frameSize = Math.floor(sampleRate * 0.05) // 50ms
  const numFrames = Math.floor(audio.length / frameSize)

  const rms: number[] = []
  for (let f = 0; f < numFrames; f++) {
    let sum = 0
    const off = f * frameSize
    for (let i = off; i < off + frameSize; i++) sum += audio[i] * audio[i]
    rms.push(Math.sqrt(sum / frameSize))
  }

  // Compute rolling variance of energy (1-second window)
  const W = 20 // 20 frames = 1s
  const variances: number[] = []
  for (let i = 0; i <= rms.length - W; i++) {
    const win = rms.slice(i, i + W)
    const mean = win.reduce((a, b) => a + b) / W
    variances.push(win.reduce((a, e) => a + (e - mean) ** 2, 0) / W)
  }

  if (variances.length === 0) return 0

  // Speech onset = first time variance exceeds 15% of its maximum
  const maxVar = Math.max(...variances)
  const threshold = maxVar * 0.15
  for (let i = 0; i < variances.length; i++) {
    if (variances[i] > threshold) return i * 50
  }
  return 0
}

/**
 * Remove the LONGEST duplicate leading prefix.
 */
function deduplicateLeadingWords<T extends { text: string }>(words: T[]): T[] {
  const limit = Math.min(20, words.length)
  let bestSplit = 0
  for (let split = 1; split <= Math.min(8, Math.floor(limit / 2)); split++) {
    const leadingCjk = words.slice(0, split).map(w => cjkText(w.text)).join('')
    if (leadingCjk.length < 2) continue
    const restCjk = words.slice(split, limit).map(w => cjkText(w.text)).join('')
    if (restCjk.includes(leadingCjk)) bestSplit = split
  }
  if (bestSplit > 0) {
    console.log(`[autosync] Dedup: removed first ${bestSplit} words "${cjkText(rawSlice(bestSplit))}"`)
    return words.slice(bestSplit)
  }
  return words

  function rawSlice(n: number) { return words.slice(0, n).map(w => w.text).join('') }
}

/**
 * Build per-CJK-char timeline from ALL chunks with non-null timestamps.
 */
function buildCharTimeline(chunks: Chunk[]): CharMs[] {
  const result: CharMs[] = []
  for (const c of chunks) {
    if (c.timestamp[0] == null || c.timestamp[1] == null) continue
    const startMs = c.timestamp[0] * 1000
    const endMs = c.timestamp[1] * 1000
    if (endMs - startMs < 50) continue
    const chars = cjkChars(c.text)
    if (chars.length === 0) continue
    const msPerChar = (endMs - startMs) / chars.length
    for (let i = 0; i < chars.length; i++) {
      result.push({ char: chars[i], ms: startMs + i * msPerChar })
    }
  }
  return result
}

/**
 * Multi-anchor alignment: match OCR segments to whisper text.
 */
function findAnchors(ocrStr: string, whisperStr: string): Anchor[] {
  const segSize = Math.min(20, Math.floor(ocrStr.length / 3), Math.floor(whisperStr.length / 3))
  if (segSize < 4) return []

  const raw: Anchor[] = []
  const step = Math.max(4, Math.floor(segSize * 0.5))

  for (let segStart = 0; segStart <= ocrStr.length - segSize; segStart += step) {
    const segment = ocrStr.slice(segStart, segStart + segSize)
    const segBg = bigramsOf(segment)
    let bestScore = 0.15
    let bestWi = -1

    for (let wi = 0; wi <= whisperStr.length - segSize; wi++) {
      const score = jaccardSim(segBg, bigramsOf(whisperStr.slice(wi, wi + segSize)))
      if (score > bestScore) { bestScore = score; bestWi = wi }
    }

    if (bestWi >= 0) {
      raw.push({
        ocrPos: segStart + Math.floor(segSize / 2),
        whisperPos: bestWi + Math.floor(segSize / 2),
        score: bestScore,
      })
    }
  }

  // Keep monotonically increasing whisperPos
  const filtered: Anchor[] = []
  let lastWp = -Infinity
  for (const a of raw) {
    if (a.whisperPos > lastWp) { filtered.push(a); lastWp = a.whisperPos }
  }
  return filtered
}

function ocrToWhisperPos(ocrPos: number, anchors: Anchor[]): number {
  if (anchors.length === 0) return ocrPos

  if (ocrPos <= anchors[0].ocrPos) {
    const ratio = anchors.length >= 2
      ? (anchors[1].whisperPos - anchors[0].whisperPos) / Math.max(1, anchors[1].ocrPos - anchors[0].ocrPos)
      : 1
    return anchors[0].whisperPos + (ocrPos - anchors[0].ocrPos) * ratio
  }

  const last = anchors[anchors.length - 1]
  if (ocrPos >= last.ocrPos) {
    const prev = anchors.length >= 2 ? anchors[anchors.length - 2] : { ocrPos: last.ocrPos - 1, whisperPos: last.whisperPos - 1 }
    const ratio = (last.whisperPos - prev.whisperPos) / Math.max(1, last.ocrPos - prev.ocrPos)
    return last.whisperPos + (ocrPos - last.ocrPos) * ratio
  }

  for (let i = 0; i < anchors.length - 1; i++) {
    if (ocrPos <= anchors[i + 1].ocrPos) {
      const frac = (ocrPos - anchors[i].ocrPos) / Math.max(1, anchors[i + 1].ocrPos - anchors[i].ocrPos)
      return anchors[i].whisperPos + frac * (anchors[i + 1].whisperPos - anchors[i].whisperPos)
    }
  }
  return ocrPos
}

/**
 * Convert whisper char position to ms, with calibration offset applied.
 * Extrapolates outside the timeline range.
 */
function whisperPosToMs(pos: number, charTimeline: CharMs[], calibrationOffsetMs: number): number {
  const tLen = charTimeline.length
  if (tLen === 0) return Math.max(0, pos * 350 + calibrationOffsetMs)

  let ms: number
  if (pos >= 0 && pos < tLen) {
    const idx = Math.floor(pos)
    const frac = pos - idx
    ms = idx + 1 < tLen
      ? charTimeline[idx].ms + frac * (charTimeline[idx + 1].ms - charTimeline[idx].ms)
      : charTimeline[idx].ms
  } else if (pos < 0) {
    const sampleEnd = Math.min(30, tLen - 1)
    const pace = (charTimeline[sampleEnd].ms - charTimeline[0].ms) / Math.max(1, sampleEnd)
    ms = charTimeline[0].ms + pos * pace
  } else {
    const sampleStart = Math.max(0, tLen - 31)
    const pace = (charTimeline[tLen - 1].ms - charTimeline[sampleStart].ms) / Math.max(1, tLen - 1 - sampleStart)
    ms = charTimeline[tLen - 1].ms + (pos - tLen + 1) * pace
  }

  return Math.max(0, ms + calibrationOffsetMs)
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

  const words = deduplicateLeadingWords(rawWords)
  const removedCount = rawWords.length - words.length

  try {
    console.log('[autosync] Decoding audio…')
    const audio = await decodeAudio(audioPath)
    const audioDurationMs = Math.round((audio.length / 16000) * 1000)

    // Detect actual audio/speech onset from waveform
    const audioOnsetMs = detectAudioOnset(audio, 16000)
    const speechOnsetMs = detectSpeechOnset(audio, 16000)
    console.log(`[autosync] Audio onset: ${audioOnsetMs}ms, Speech onset: ${speechOnsetMs}ms`)

    const lang = LANG_MAP[book.language ?? 'zh'] ?? 'chinese'
    const chunks = await transcribe(audio, lang)

    console.log(`[autosync] ${chunks.length} Whisper segments`)
    chunks.slice(0, 8).forEach((c, i) =>
      console.log(`  [${i}] ${c.timestamp[0]}s–${c.timestamp[1]}s  "${c.text.slice(0, 50)}"`)
    )

    // Build char timeline
    const charTimeline = buildCharTimeline(chunks)
    const whisperStr = charTimeline.map(c => c.char).join('')
    const ocrStr = words.map(w => cjkText(w.text)).join('')
    const wordCjkLens = words.map(w => Math.max(1, cjkChars(w.text).length))

    // Whisper's first CJK timestamp
    const whisperFirstMs = charTimeline.length > 0 ? charTimeline[0].ms : 0

    // Calibration: if Whisper thinks speech starts much later than the
    // waveform analysis shows, apply a correction offset.
    // Speech onset from waveform is the ground truth for when narration begins.
    // Whisper's first timestamp is where IT thinks speech starts.
    // The difference is the calibration offset.
    const bestOnset = Math.max(speechOnsetMs, audioOnsetMs)
    let calibrationOffsetMs = 0
    if (whisperFirstMs > 0 && bestOnset > 0 && whisperFirstMs > bestOnset + 5000) {
      // Whisper's first timestamp is >5s later than detected speech onset.
      // Whisper likely hallucinated/skipped the early part.
      // Shift all Whisper timestamps backward by the difference.
      calibrationOffsetMs = bestOnset - whisperFirstMs
      console.log(`[autosync] CALIBRATION: shifting Whisper timestamps by ${calibrationOffsetMs}ms (onset=${bestOnset}ms, whisper=${whisperFirstMs}ms)`)
    }

    console.log(`[autosync] Whisper: ${whisperStr.length} CJK chars (${whisperFirstMs.toFixed(0)}ms–${(charTimeline[charTimeline.length - 1]?.ms ?? 0).toFixed(0)}ms)`)
    console.log(`[autosync] OCR: ${ocrStr.length} CJK chars, ${words.length} words`)

    // Multi-anchor alignment
    const anchors = findAnchors(ocrStr, whisperStr)
    console.log(`[autosync] Found ${anchors.length} anchors:`)
    for (const a of anchors) {
      const rawMs = charTimeline[Math.min(a.whisperPos, charTimeline.length - 1)]?.ms ?? 0
      const calMs = rawMs + calibrationOffsetMs
      console.log(`  ocr[${a.ocrPos}]→wh[${a.whisperPos}] raw=${(rawMs / 1000).toFixed(1)}s cal=${(calMs / 1000).toFixed(1)}s score=${a.score.toFixed(2)}`)
    }

    // Map OCR words → whisper positions → calibrated ms
    const timings: { wordId: string; startMs: number; endMs: number }[] = []
    let ocrCharCum = 0

    for (let i = 0; i < words.length; i++) {
      const ocrStart = ocrCharCum
      const ocrEnd = ocrCharCum + wordCjkLens[i]
      ocrCharCum = ocrEnd

      const wPosStart = ocrToWhisperPos(ocrStart, anchors)
      const wPosEnd = ocrToWhisperPos(ocrEnd, anchors)

      const startMs = Math.round(whisperPosToMs(wPosStart, charTimeline, calibrationOffsetMs))
      const endMs = Math.max(startMs + 50, Math.round(whisperPosToMs(wPosEnd, charTimeline, calibrationOffsetMs)))

      timings.push({ wordId: words[i].id, startMs, endMs })
    }

    // Debug output
    const transcriptDir = path.join(process.cwd(), 'storage', 'transcripts')
    mkdirSync(transcriptDir, { recursive: true })

    const lines: string[] = []
    lines.push(`=== AUTOSYNC DEBUG: ${bookId} ===`)
    lines.push(`Audio: ${(audioDurationMs / 1000).toFixed(1)}s | Title: "${book.title}"`)
    lines.push(`Audio onset: ${audioOnsetMs}ms | Speech onset: ${speechOnsetMs}ms`)
    lines.push(`Whisper first CJK: ${whisperFirstMs.toFixed(0)}ms`)
    lines.push(`Calibration offset: ${calibrationOffsetMs}ms`)
    lines.push(`OCR: ${rawWords.length}→${words.length} words (removed ${removedCount}), ${ocrStr.length} CJK`)
    lines.push(`Whisper: ${whisperStr.length} CJK, ${(charTimeline[0]?.ms ?? 0).toFixed(0)}ms–${(charTimeline[charTimeline.length - 1]?.ms ?? 0).toFixed(0)}ms`)
    lines.push('')
    lines.push(`--- ANCHORS (${anchors.length}) ---`)
    for (const a of anchors) {
      const rawMs = charTimeline[Math.min(a.whisperPos, charTimeline.length - 1)]?.ms ?? 0
      lines.push(`  ocr[${a.ocrPos}] → wh[${a.whisperPos}] = ${((rawMs + calibrationOffsetMs) / 1000).toFixed(2)}s (raw ${(rawMs / 1000).toFixed(2)}s)  score=${a.score.toFixed(3)}  ocr="…${ocrStr.slice(Math.max(0, a.ocrPos - 8), a.ocrPos + 8)}…"  wh="…${whisperStr.slice(Math.max(0, a.whisperPos - 8), a.whisperPos + 8)}…"`)
    }
    lines.push('')
    lines.push('--- OCR WORDS → AUDIO TIMESTAMPS ---')
    lines.push('')
    ocrCharCum = 0
    for (let i = 0; i < timings.length; i++) {
      const t = timings[i]
      const ocrStart = ocrCharCum
      ocrCharCum += wordCjkLens[i]
      const wPos = ocrToWhisperPos(ocrStart, anchors)
      const inRange = wPos >= 0 && wPos < charTimeline.length
      const flag = inRange ? '' : ' [extrapolated]'
      lines.push(`  [${String(i).padStart(3)}] ${(t.startMs / 1000).toFixed(2).padStart(7)}s – ${(t.endMs / 1000).toFixed(2).padStart(7)}s  "${words[i]?.text}"${flag}`)
    }
    lines.push('')
    lines.push('--- WHISPER SEGMENTS ---')
    lines.push('')
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]
      const cjk = cjkChars(c.text).length
      const rawStart = c.timestamp[0] != null ? (c.timestamp[0] * 1000).toFixed(0) : '?'
      const calStart = c.timestamp[0] != null ? ((c.timestamp[0] * 1000 + calibrationOffsetMs) / 1000).toFixed(2) : '?'
      lines.push(`  [${String(i).padStart(3)}] raw=${rawStart}ms cal=${calStart}s  (${cjk} CJK)  "${c.text.slice(0, 70)}"`)
    }

    writeFileSync(path.join(transcriptDir, `${bookId}.txt`), lines.join('\n'))
    writeFileSync(path.join(transcriptDir, `${bookId}.json`), JSON.stringify({
      audioDurationMs, calibrationOffsetMs, audioOnsetMs, speechOnsetMs,
      whisperFirstMs, anchors,
      ocrTimings: timings.map((t, i) => ({
        word: words[i]?.text,
        startSec: +(t.startMs / 1000).toFixed(2),
        endSec: +(t.endMs / 1000).toFixed(2),
      })),
    }, null, 2))

    // Save to DB
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
      removedDuplicates: removedCount,
      anchorCount: anchors.length,
      calibrationOffsetMs,
      audioOnsetMs,
      speechOnsetMs,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[autosync] Error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
