import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import PlanDetail from './PlanDetail'

export default async function PlanPage({ params }: { params: Promise<{ childId: string; planId: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const { childId, planId } = await params
  const plan = await prisma.exercisePlan.findUnique({
    where: { id: planId },
    include: {
      child: true,
      words: {
        orderBy: { orderIdx: 'asc' },
        include: {
          word: {
            include: {
              timing: true,
              page: { select: { pageNum: true, imagePath: true, bookId: true } },
            },
          },
        },
      },
      sessions: {
        orderBy: { completedAt: 'desc' },
        include: {
          results: {
            include: { word: { select: { id: true, text: true } } },
          },
        },
      },
    },
  })

  if (!plan || plan.childId !== childId) notFound()

  // Get audio for each referenced book
  const bookIds = [...new Set(plan.words.map(pw => pw.word.page.bookId))]
  const books = await prisma.book.findMany({ where: { id: { in: bookIds } }, select: { id: true, audioUrl: true } })
  const audioByBook = Object.fromEntries(books.map(b => [b.id, b.audioUrl]))

  const words = plan.words.map(pw => ({
    wordId: pw.word.id,
    text: pw.word.text,
    imagePath: pw.word.page.imagePath,
    pageNum: pw.word.page.pageNum,
    x: pw.word.x, y: pw.word.y, w: pw.word.w, h: pw.word.h,
    timing: pw.word.timing,
    audioUrl: audioByBook[pw.word.page.bookId] ?? null,
  }))

  return (
    <PlanDetail
      childId={childId}
      planId={planId}
      planName={plan.name}
      childName={plan.child.name}
      childColor={plan.child.color}
      words={words}
      sessions={plan.sessions.map(s => ({
        id: s.id,
        score: s.score,
        total: s.total,
        completedAt: s.completedAt.toISOString(),
        results: s.results.map(r => ({ wordId: r.wordId, text: r.word.text, correct: r.correct })),
      }))}
    />
  )
}
