import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/** PUT — upsert a word timing */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ wordId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { wordId } = await params
  const { startMs, endMs } = await req.json() as { startMs: number; endMs: number }

  const timing = await prisma.wordTiming.upsert({
    where: { wordId },
    update: { startMs, endMs },
    create: { wordId, startMs, endMs },
  })

  return NextResponse.json(timing)
}

/** DELETE — remove a word timing */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ wordId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { wordId } = await params
  await prisma.wordTiming.deleteMany({ where: { wordId } })
  return NextResponse.json({ ok: true })
}
