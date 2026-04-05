import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { pageId } = await params
  const words = await prisma.word.findMany({
    where: { pageId },
    orderBy: { orderIdx: 'asc' },
  })

  return NextResponse.json(words)
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { pageId } = await params
  const { text, x, y, w, h } = await req.json()

  const count = await prisma.word.count({ where: { pageId } })
  const word = await prisma.word.create({
    data: { pageId, text, x, y, w, h, orderIdx: count },
  })

  return NextResponse.json(word)
}
