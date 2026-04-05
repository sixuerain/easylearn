import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { unlink } from 'fs/promises'
import path from 'path'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; pageId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: bookId, pageId } = await params
  const page = await prisma.page.findUnique({ where: { id: pageId } })
  if (!page) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Delete image file
  try {
    await unlink(path.join(process.cwd(), 'public', page.imagePath))
  } catch { /* file may not exist */ }

  await prisma.page.delete({ where: { id: pageId } })

  // Renumber remaining pages
  const remaining = await prisma.page.findMany({
    where: { bookId },
    orderBy: { pageNum: 'asc' },
  })
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].pageNum !== i + 1) {
      await prisma.page.update({ where: { id: remaining[i].id }, data: { pageNum: i + 1 } })
    }
  }

  return NextResponse.json({ ok: true })
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; pageId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: bookId, pageId } = await params
  const { direction } = await req.json() as { direction: 'up' | 'down' }

  const page = await prisma.page.findUnique({ where: { id: pageId } })
  if (!page) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const targetNum = direction === 'up' ? page.pageNum - 1 : page.pageNum + 1
  const adjacent = await prisma.page.findFirst({ where: { bookId, pageNum: targetNum } })
  if (!adjacent) return NextResponse.json({ error: 'Cannot move' }, { status: 400 })

  // Swap page numbers using a temp value to avoid conflicts
  await prisma.page.update({ where: { id: page.id }, data: { pageNum: -1 } })
  await prisma.page.update({ where: { id: adjacent.id }, data: { pageNum: page.pageNum } })
  await prisma.page.update({ where: { id: page.id }, data: { pageNum: targetNum } })

  const pages = await prisma.page.findMany({
    where: { bookId },
    orderBy: { pageNum: 'asc' },
  })

  return NextResponse.json(pages)
}
