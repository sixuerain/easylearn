import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import jsQR from 'jsqr'

/** Expand a single-channel greyscale buffer to RGBA for jsQR */
function greyToRGBA(buf: Buffer, w: number, h: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = buf[i]
    rgba[i * 4 + 3] = 255
  }
  return rgba
}

/**
 * Multi-strategy QR detection:
 *  1. Standard RGBA scan at multiple resolutions
 *  2. Green-channel scan (catches red/coloured QR codes)
 *  3. Quadrant scans with green channel (catches small QR codes)
 *
 * Collects ALL detections and returns the longest result — avoids returning
 * a truncated URL from a low-resolution scan when a higher-resolution scan
 * would yield the full URL (including query parameters).
 */
async function detectQR(buffer: Buffer): Promise<string | null> {
  const candidates: string[] = []

  // Strategy 1: standard full-image RGBA
  for (const size of [800, 1200, 1600]) {
    const { data, info } = await sharp(buffer)
      .resize(size, size, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const code = jsQR(new Uint8ClampedArray(data), info.width, info.height)
    if (code?.data) candidates.push(code.data)
  }

  // Strategy 2: green channel (red/coloured QR codes have high contrast in green)
  for (const size of [1200, 1600]) {
    const { data, info } = await sharp(buffer)
      .resize(size, size, { fit: 'inside' })
      .extractChannel('green')
      .normalise()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const code = jsQR(greyToRGBA(data, info.width, info.height), info.width, info.height)
    if (code?.data) candidates.push(code.data)
  }

  // Strategy 3: scan four quadrants with green channel (finds small QR codes)
  const meta = await sharp(buffer).metadata()
  const W = meta.width ?? 1080
  const H = meta.height ?? 1920
  const half = { w: Math.floor(W / 2), h: Math.floor(H / 2) }
  const quadrants = [
    { left: 0,       top: 0,       width: half.w, height: half.h },
    { left: half.w,  top: 0,       width: half.w, height: half.h },
    { left: 0,       top: half.h,  width: half.w, height: half.h },
    { left: half.w,  top: half.h,  width: half.w, height: half.h },
  ]
  for (const quad of quadrants) {
    const { data, info } = await sharp(buffer)
      .extract(quad)
      .resize(800, 800, { fit: 'inside' })
      .extractChannel('green')
      .normalise()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const code = jsQR(greyToRGBA(data, info.width, info.height), info.width, info.height)
    if (code?.data) candidates.push(code.data)
  }

  if (candidates.length === 0) return null
  // Return the longest result — partial reads at low resolution produce shorter strings
  return candidates.reduce((a, b) => (a.length >= b.length ? a : b))
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: bookId } = await params
  const book = await prisma.book.findUnique({ where: { id: bookId } })
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const formData = await req.formData()
  const file = formData.get('image') as File | null
  if (!file) return NextResponse.json({ error: 'No image' }, { status: 400 })

  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)

  // Resize for storage: max 2000px, JPEG q85
  const processed = await sharp(buffer)
    .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()

  // Save to disk
  const dir = path.join(process.cwd(), 'public', 'uploads', 'books', bookId)
  await mkdir(dir, { recursive: true })
  const fileId = crypto.randomUUID()
  const filename = `${fileId}.jpg`
  await writeFile(path.join(dir, filename), processed)

  // QR code detection (only if no audio URL yet)
  if (!book.audioUrl) {
    try {
      const url = await detectQR(buffer)
      if (url) {
        await prisma.book.update({ where: { id: bookId }, data: { audioUrl: url } })
      }
    } catch {
      // QR detection optional — ignore errors
    }
  }

  const pageCount = await prisma.page.count({ where: { bookId } })
  const page = await prisma.page.create({
    data: {
      bookId,
      pageNum: pageCount + 1,
      imagePath: `/api/img/books/${bookId}/${filename}`,
    },
  })

  return NextResponse.json(page)
}
