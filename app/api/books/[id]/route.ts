import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { rm } from 'fs/promises'
import path from 'path'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const book = await prisma.book.findUnique({
    where: { id },
    include: { pages: { orderBy: { pageNum: 'asc' } } },
  })

  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(book)
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const data = await req.json()

  const book = await prisma.book.update({
    where: { id },
    data: { title: data.title, language: data.language, audioUrl: data.audioUrl },
  })

  return NextResponse.json(book)
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // Delete book (cascades to pages/words/timings in DB)
  await prisma.book.delete({ where: { id } })

  // Clean up uploaded image files
  const bookDir = path.join(process.cwd(), 'public', 'uploads', 'books', id)
  await rm(bookDir, { recursive: true, force: true })

  return NextResponse.json({ ok: true })
}
