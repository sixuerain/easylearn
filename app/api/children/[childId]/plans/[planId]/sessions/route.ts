import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type Ctx = { params: Promise<{ childId: string; planId: string }> }

export async function POST(req: Request, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { childId, planId } = await params
  const { results } = await req.json() as { results: { wordId: string; correct: boolean }[] }

  const score = results.filter(r => r.correct).length
  const total = results.length

  const sessionRecord = await prisma.exerciseSession.create({
    data: {
      planId,
      childId,
      score,
      total,
      results: { create: results.map(r => ({ wordId: r.wordId, correct: r.correct })) },
    },
    include: { results: true },
  })
  return NextResponse.json(sessionRecord)
}
