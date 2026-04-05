import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type Ctx = { params: Promise<{ childId: string; wordId: string }> }

export async function POST(_req: Request, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { childId, wordId } = await params
  const bm = await prisma.wordBookmark.upsert({
    where: { childId_wordId: { childId, wordId } },
    update: {},
    create: { childId, wordId },
  })
  return NextResponse.json(bm)
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { childId, wordId } = await params
  await prisma.wordBookmark.deleteMany({ where: { childId, wordId } })
  return NextResponse.json({ ok: true })
}
