import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLocalAudioPath, inferAudioExt } from '@/lib/audio'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

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

/** POST — download audioUrl to local storage */
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

  try {
    const res = await fetch(book.audioUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const contentType = res.headers.get('content-type') ?? ''
    const ext = inferAudioExt(contentType, book.audioUrl)

    const dir = path.join(process.cwd(), 'public', 'uploads', 'audio')
    await mkdir(dir, { recursive: true })

    const filename = `${id}.${ext}`
    const buffer = Buffer.from(await res.arrayBuffer())
    await writeFile(path.join(dir, filename), buffer)

    const localPath = `/uploads/audio/${filename}`
    return NextResponse.json({ localPath })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Download failed: ${msg}` }, { status: 502 })
  }
}
