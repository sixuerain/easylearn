import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLocalAudioPath } from '@/lib/audio'
import path from 'path'

/** Parse audio duration from local file using music-metadata */
async function getAudioDurationMs(bookId: string): Promise<number | null> {
  const served = getLocalAudioPath(bookId)
  if (!served) return null
  // served = /api/audio/{bookId}.ext — resolve to storage/audio/{bookId}.ext
  const filename = served.replace(/^\/api\/audio\//, '')
  const filePath = path.join(process.cwd(), 'storage', 'audio', filename)
  try {
    const { parseFile } = await import('music-metadata')
    const meta = await parseFile(filePath)
    const secs = meta.format.duration
    return secs ? Math.round(secs * 1000) : null
  } catch {
    return null
  }
}

/**
 * POST /api/books/[id]/autosync
 *
 * Automatically assigns word timings proportional to character count.
 * Each Chinese character takes roughly equal spoken time, so this gives
 * a reasonable first approximation without manual stamping.
 *
 * Optional body: { startMs?: number, endMs?: number } to constrain the range.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: bookId } = await params

  // Get total audio duration
  const totalMs = await getAudioDurationMs(bookId)
  if (!totalMs) {
    return NextResponse.json({ error: 'No local audio cached. Download audio first via the Sync page.' }, { status: 400 })
  }

  // Load all pages + words in order
  const pages = await prisma.page.findMany({
    where: { bookId },
    orderBy: { pageNum: 'asc' },
    include: { words: { orderBy: { orderIdx: 'asc' } } },
  })

  const words = pages.flatMap(p => p.words)
  if (words.length === 0) {
    return NextResponse.json({ error: 'No words found. Run OCR on pages first.' }, { status: 400 })
  }

  // Optional custom range from request body
  const body = await req.json().catch(() => ({}))
  const rangeStart = typeof body.startMs === 'number' ? body.startMs : 0
  const rangeEnd   = typeof body.endMs   === 'number' ? body.endMs   : totalMs
  const rangeMs    = rangeEnd - rangeStart

  // Weight each word by character count (Chinese chars ≈ equal duration)
  const charCounts = words.map(w => Math.max(1, [...w.text].length))
  const totalChars = charCounts.reduce((a, b) => a + b, 0)

  // Build timings: each word gets a proportional slice of the audio
  let cursor = rangeStart
  const timings: { id: string; startMs: number; endMs: number }[] = []
  for (let i = 0; i < words.length; i++) {
    const slice = Math.round((charCounts[i] / totalChars) * rangeMs)
    const startMs = cursor
    const endMs = i === words.length - 1 ? rangeEnd : cursor + slice
    timings.push({ id: words[i].id, startMs, endMs })
    cursor = endMs
  }

  // Upsert timings into the database
  await Promise.all(
    timings.map(({ id, startMs, endMs }) =>
      prisma.wordTiming.upsert({
        where: { wordId: id },
        create: { wordId: id, startMs, endMs },
        update: { startMs, endMs },
      })
    )
  )

  return NextResponse.json({ ok: true, wordCount: words.length, totalMs })
}
