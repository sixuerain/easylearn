import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type Ctx = { params: Promise<{ childId: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { childId } = await params
  const plans = await prisma.exercisePlan.findMany({
    where: { childId },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { words: true, sessions: true } },
      sessions: { orderBy: { completedAt: 'desc' }, take: 1 },
    },
  })
  return NextResponse.json(plans)
}

export async function POST(req: Request, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { childId } = await params
  const { name, wordIds } = await req.json() as { name: string; wordIds: string[] }
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  const plan = await prisma.exercisePlan.create({
    data: {
      childId,
      name: name.trim(),
      words: {
        create: wordIds.map((wordId, i) => ({ wordId, orderIdx: i })),
      },
    },
    include: { words: true },
  })
  return NextResponse.json(plan)
}
