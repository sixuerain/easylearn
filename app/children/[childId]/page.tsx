import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import BookmarkList from './BookmarkList'

export default async function ChildDashboard({ params }: { params: Promise<{ childId: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const { childId } = await params
  const child = await prisma.child.findUnique({
    where: { id: childId },
    include: {
      plans: {
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { words: true, sessions: true } },
          sessions: { orderBy: { completedAt: 'desc' }, take: 1, select: { score: true, total: true, completedAt: true } },
        },
      },
      bookmarks: {
        orderBy: { createdAt: 'asc' },
        include: {
          word: {
            include: {
              timing: true,
              page: { select: { id: true, pageNum: true, imagePath: true, bookId: true } },
            },
          },
        },
      },
    },
  })

  if (!child) notFound()

  // Find audio for each book referenced by bookmarks
  const bookIds = [...new Set(child.bookmarks.map(b => b.word.page.bookId))]
  const books = await prisma.book.findMany({
    where: { id: { in: bookIds } },
    select: { id: true, audioUrl: true },
  })
  const audioByBook = Object.fromEntries(books.map(b => [b.id, b.audioUrl]))

  return (
    <main className="min-h-screen bg-amber-50 p-4">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6 pt-2">
          <Link href="/" className="text-amber-600 text-2xl leading-none">←</Link>
          <div className="flex items-center gap-3 flex-1">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-lg"
              style={{ backgroundColor: child.color }}>
              {child.name[0].toUpperCase()}
            </div>
            <h1 className="text-2xl font-bold text-gray-800">{child.name}</h1>
          </div>
          <Link href="/children" className="text-gray-400 text-sm hover:text-gray-600">Manage</Link>
        </div>

        {/* Exercise Plans */}
        <section className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-gray-700">Exercise Plans</h2>
            <Link href={`/children/${childId}/plans/new`}
              className="text-xs bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg font-medium transition-colors">
              + New Plan
            </Link>
          </div>
          {child.plans.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-5 text-center">
              <p className="text-gray-400 text-sm">No exercise plans yet.</p>
              <p className="text-gray-400 text-xs mt-1">Bookmark words while reading, then create a plan to practise them.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {child.plans.map(plan => {
                const last = plan.sessions[0]
                const pct = last && last.total > 0 ? Math.round(last.score / last.total * 100) : null
                return (
                  <Link key={plan.id} href={`/children/${childId}/plans/${plan.id}`}
                    className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-4 hover:shadow-md transition-shadow block">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-800 truncate">{plan.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {plan._count.words} words · {plan._count.sessions} session{plan._count.sessions !== 1 ? 's' : ''}
                      </p>
                    </div>
                    {pct !== null ? (
                      <div className={`text-lg font-bold ${pct >= 80 ? 'text-green-500' : pct >= 50 ? 'text-amber-500' : 'text-red-400'}`}>
                        {pct}%
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">Not done</span>
                    )}
                    <span className="text-gray-300 text-lg">›</span>
                  </Link>
                )
              })}
            </div>
          )}
        </section>

        {/* Bookmarked Words */}
        <section>
          <h2 className="text-lg font-bold text-gray-700 mb-3">
            Bookmarked Words
            <span className="ml-2 text-sm font-normal text-gray-400">({child.bookmarks.length})</span>
          </h2>
          {child.bookmarks.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-5 text-center">
              <p className="text-gray-400 text-sm">No bookmarks yet.</p>
              <p className="text-gray-400 text-xs mt-1">Tap ⭐ on a word while reading to save it here.</p>
            </div>
          ) : (
            <BookmarkList
              childId={childId}
              bookmarks={child.bookmarks.map(b => ({
                id: b.id,
                wordId: b.word.id,
                text: b.word.text,
                imagePath: b.word.page.imagePath,
                bookId: b.word.page.bookId,
                pageNum: b.word.page.pageNum,
                x: b.word.x, y: b.word.y, w: b.word.w, h: b.word.h,
                timing: b.word.timing,
                audioUrl: audioByBook[b.word.page.bookId] ?? null,
              }))}
            />
          )}
        </section>
      </div>
    </main>
  )
}
