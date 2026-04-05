import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getLocalAudioPath } from '@/lib/audio'
import SyncTool from './SyncTool'

export default async function SyncPage({ params }: { params: Promise<{ id: string }> }) {
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

  return (
    <SyncTool
      bookId={id}
      audioUrl={book.audioUrl}
      localAudioPath={localAudioPath}
      pages={book.pages}
    />
  )
}
