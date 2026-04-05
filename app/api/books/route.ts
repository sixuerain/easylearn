import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const books = await prisma.book.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      pages: { orderBy: { pageNum: 'asc' }, take: 1 },
      _count: { select: { pages: true } },
    },
  })

  return NextResponse.json(books)
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { title, language } = await req.json()
  if (!title?.trim()) return NextResponse.json({ error: 'Title required' }, { status: 400 })

  const book = await prisma.book.create({
    data: { title: title.trim(), language: language || 'en' },
  })

  return NextResponse.json(book)
}
