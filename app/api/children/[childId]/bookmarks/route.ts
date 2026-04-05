import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type Ctx = { params: Promise<{ childId: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { childId } = await params
  const bookmarks = await prisma.wordBookmark.findMany({
    where: { childId },
    orderBy: { createdAt: 'asc' },
    include: {
      word: {
        include: {
          timing: true,
          page: { select: { id: true, pageNum: true, imagePath: true, bookId: true } },
        },
      },
    },
  })
  return NextResponse.json(bookmarks)
}
