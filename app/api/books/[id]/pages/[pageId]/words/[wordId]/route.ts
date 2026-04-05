import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ wordId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { wordId } = await params
  const { text } = await req.json()

  const word = await prisma.word.update({
    where: { id: wordId },
    data: { text: text.trim() },
  })

  return NextResponse.json(word)
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ pageId: string; wordId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { pageId, wordId } = await params
  await prisma.word.deleteMany({ where: { id: wordId } })

  // Renumber remaining words
  const remaining = await prisma.word.findMany({
    where: { pageId },
    orderBy: { orderIdx: 'asc' },
  })
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].orderIdx !== i) {
      await prisma.word.update({ where: { id: remaining[i].id }, data: { orderIdx: i } })
    }
  }

  return NextResponse.json({ ok: true })
}
