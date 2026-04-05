import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { runOcr } from '@/lib/ocr'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; pageId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { pageId } = await params

  const page = await prisma.page.findUnique({
    where: { id: pageId },
    include: { book: { select: { language: true } } },
  })
  if (!page) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Clear existing words (timings cascade-deleted via schema)
  await prisma.word.deleteMany({ where: { pageId } })

  // Run OCR — may take 5–15s on first run (downloads language data)
  const ocrWords = await runOcr(page.imagePath, page.book.language)

  if (ocrWords.length > 0) {
    await prisma.word.createMany({
      data: ocrWords.map(w => ({
        pageId,
        text: w.text,
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        orderIdx: w.orderIdx,
      })),
    })
  }

  const saved = await prisma.word.findMany({
    where: { pageId },
    orderBy: { orderIdx: 'asc' },
  })

  return NextResponse.json(saved)
}
