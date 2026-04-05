import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getLocalAudioPath } from '@/lib/audio'
import Reader from './Reader'

export default async function ReadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ child?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const { id } = await params
  const { child: childId } = await searchParams

  const [book, childData] = await Promise.all([
    prisma.book.findUnique({
      where: { id },
      include: {
        pages: {
          orderBy: { pageNum: 'asc' },
          include: {
            words: {
              orderBy: { orderIdx: 'asc' },
              include: { timing: true },
            },
          },
        },
      },
    }),
    childId ? Promise.all([
      prisma.readingProgress.findUnique({ where: { childId_bookId: { childId, bookId: id } } }),
      prisma.wordBookmark.findMany({ where: { childId }, select: { wordId: true } }),
    ]) : Promise.resolve(null),
  ])

  if (!book) notFound()

  const localAudioPath = getLocalAudioPath(id)
  const audioSrc = localAudioPath ?? book.audioUrl ?? null
  const initialPageIdx = childData?.[0]?.pageIdx ?? 0
  const initialBookmarks = childData ? childData[1].map((b: { wordId: string }) => b.wordId) : []

  return (
    <Reader
      bookId={id}
      title={book.title}
      audioSrc={audioSrc}
      pages={book.pages}
      childId={childId ?? null}
      initialPageIdx={initialPageIdx}
      initialBookmarks={initialBookmarks}
    />
  )
}
