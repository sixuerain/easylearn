import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLocalAudioPath, inferAudioExt } from '@/lib/audio'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

const AUDIO_MIME = ['audio/', 'video/mp4', 'video/mpeg', 'application/octet-stream']

/** Try to fetch a direct audio URL and return its buffer + ext.  Returns null if not audio. */
async function fetchDirect(url: string): Promise<{ buffer: Buffer; ext: string } | null> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Range': 'bytes=0-' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('text/html')) return null
  const ext = inferAudioExt(contentType, url)
  const buffer = Buffer.from(await res.arrayBuffer())
  return { buffer, ext }
}

/**
 * Use Playwright to open the streaming page, intercept the first audio request,
 * and return the resolved direct URL.
 */
async function resolveStreamingUrl(pageUrl: string): Promise<string | null> {
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    })
    const page = await context.newPage()

    let audioUrl: string | null = null

    // Intercept every request — capture the first audio file URL
    page.on('request', req => {
      if (audioUrl) return
      const url = req.url()
      if (/\.(mp3|aac|m4a|ogg|wav)(\?|$)/i.test(url) ||
          (req.resourceType() === 'media') ||
          (req.resourceType() === 'fetch' && /audio/i.test(url))) {
        audioUrl = url
      }
    })

    await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 30000 })

    // Try clicking the play button if no audio intercepted yet
    if (!audioUrl) {
      try {
        await page.click('button, [class*="play"], [class*="Play"]', { timeout: 3000 })
        await page.waitForTimeout(3000)
      } catch { /* no play button found */ }
    }

    return audioUrl
  } finally {
    await browser.close()
  }
}

/** GET — return local audio path if already downloaded */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const localPath = getLocalAudioPath(id)
  return NextResponse.json({ localPath })
}

/** POST — download audioUrl to local storage, using Playwright for streaming pages */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const book = await prisma.book.findUnique({ where: { id } })
  if (!book?.audioUrl) return NextResponse.json({ error: 'No audio URL' }, { status: 400 })

  // Already downloaded?
  const existing = getLocalAudioPath(id)
  if (existing) return NextResponse.json({ localPath: existing })

  const dir = path.join(process.cwd(), 'storage', 'audio')
  await mkdir(dir, { recursive: true })

  try {
    // Step 1: try direct fetch
    const direct = await fetchDirect(book.audioUrl).catch(() => null)
    if (direct) {
      const filename = `${id}.${direct.ext}`
      await writeFile(path.join(dir, filename), direct.buffer)
      return NextResponse.json({ localPath: `/uploads/audio/${filename}` })
    }

    // Step 2: streaming page — use Playwright to find the real audio URL
    console.log('[audio] Streaming page detected, launching Playwright…')
    const resolvedUrl = await resolveStreamingUrl(book.audioUrl)
    if (!resolvedUrl) {
      return NextResponse.json(
        { error: 'not_found', message: 'Could not locate an audio stream on the page. Try "Custom URL" and paste a direct .mp3/.m4a link.' },
        { status: 422 }
      )
    }

    console.log('[audio] Resolved audio URL:', resolvedUrl)
    const audioRes = await fetch(resolvedUrl, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: book.audioUrl } })
    if (!audioRes.ok) throw new Error(`Audio fetch HTTP ${audioRes.status}`)

    const contentType = audioRes.headers.get('content-type') ?? ''
    const ext = inferAudioExt(contentType, resolvedUrl)
    const buffer = Buffer.from(await audioRes.arrayBuffer())
    const filename = `${id}.${ext}`
    await writeFile(path.join(dir, filename), buffer)

    return NextResponse.json({ localPath: `/uploads/audio/${filename}` })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Download failed: ${msg}` }, { status: 502 })
  }
}
