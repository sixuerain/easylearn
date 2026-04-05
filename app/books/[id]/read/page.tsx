import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getLocalAudioPath } from '@/lib/audio'
import Reader from './Reader'

export default async function ReadPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const { id } = await params
  const book = await prisma.book.findUnique({
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
  })

  if (!book) notFound()

  const localAudioPath = getLocalAudioPath(id)
  const audioSrc = localAudioPath ?? book.audioUrl ?? null

  return (
    <Reader
      bookId={id}
      title={book.title}
      audioSrc={audioSrc}
      pages={book.pages}
    />
  )
}
