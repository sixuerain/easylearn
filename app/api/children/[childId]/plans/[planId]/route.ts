import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type Ctx = { params: Promise<{ childId: string; planId: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { planId } = await params
  const plan = await prisma.exercisePlan.findUnique({
    where: { id: planId },
    include: {
      words: {
        orderBy: { orderIdx: 'asc' },
        include: {
          word: {
            include: {
              timing: true,
              page: { select: { id: true, pageNum: true, imagePath: true, bookId: true } },
            },
          },
        },
      },
      sessions: {
        orderBy: { completedAt: 'desc' },
        include: { results: { include: { word: { select: { id: true, text: true } } } } },
      },
    },
  })
  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(plan)
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { planId } = await params
  await prisma.exercisePlan.delete({ where: { id: planId } })
  return NextResponse.json({ ok: true })
}
