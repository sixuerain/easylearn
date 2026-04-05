import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import NewPlanForm from './NewPlanForm'

export default async function NewPlanPage({ params }: { params: Promise<{ childId: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const { childId } = await params
  const child = await prisma.child.findUnique({
    where: { id: childId },
    include: {
      bookmarks: {
        orderBy: { createdAt: 'asc' },
        include: {
          word: {
            include: {
              timing: true,
              page: { select: { pageNum: true, imagePath: true, bookId: true } },
            },
          },
        },
      },
    },
  })
  if (!child) notFound()

  return (
    <NewPlanForm
      childId={childId}
      childName={child.name}
      bookmarks={child.bookmarks.map(b => ({
        wordId: b.word.id,
        text: b.word.text,
        imagePath: b.word.page.imagePath,
        pageNum: b.word.page.pageNum,
        bookId: b.word.page.bookId,
        hasTiming: !!b.word.timing,
      }))}
    />
  )
}
