import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type Ctx = { params: Promise<{ childId: string; bookId: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { childId, bookId } = await params
  const p = await prisma.readingProgress.findUnique({ where: { childId_bookId: { childId, bookId } } })
  return NextResponse.json(p ?? { pageIdx: 0 })
}

export async function PUT(req: Request, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { childId, bookId } = await params
  const { pageIdx } = await req.json() as { pageIdx: number }
  const p = await prisma.readingProgress.upsert({
    where: { childId_bookId: { childId, bookId } },
    update: { pageIdx },
    create: { childId, bookId, pageIdx },
  })
  return NextResponse.json(p)
}
