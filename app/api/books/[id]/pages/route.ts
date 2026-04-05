import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import jsQR from 'jsqr'

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
      const { data, info } = await sharp(buffer)
        .resize(1200, 1200, { fit: 'inside' })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })

      const code = jsQR(new Uint8ClampedArray(data), info.width, info.height)
      if (code?.data) {
        await prisma.book.update({ where: { id: bookId }, data: { audioUrl: code.data } })
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
      imagePath: `/uploads/books/${bookId}/${filename}`,
    },
  })

  return NextResponse.json(page)
}
