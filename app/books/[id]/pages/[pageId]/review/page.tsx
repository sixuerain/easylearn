import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import WordOverlay from './WordOverlay'

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string; pageId: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const { id: bookId, pageId } = await params

  const page = await prisma.page.findUnique({
    where: { id: pageId },
    include: { words: { orderBy: { orderIdx: 'asc' } } },
  })

  if (!page || page.bookId !== bookId) notFound()

  return (
    <WordOverlay
      bookId={bookId}
      pageId={pageId}
      imagePath={page.imagePath}
      initialWords={page.words}
      pageNum={page.pageNum}
    />
  )
}
