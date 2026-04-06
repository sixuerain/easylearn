import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import HomeClient from './HomeClient'

export default async function Home() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const [books, children] = await Promise.all([
    prisma.book.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        pages: { orderBy: { pageNum: 'asc' }, take: 1 },
        _count: { select: { pages: true } },
        progress: { select: { childId: true, pageIdx: true } },
      },
    }),
    prisma.child.findMany({ orderBy: { createdAt: 'asc' } }),
  ])

  return (
    <main className="min-h-screen bg-amber-50 p-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 pt-2">
          <div>
            <h1 className="text-3xl font-bold text-amber-600">EasyLearn</h1>
            <p className="text-xs text-gray-400">Read along with your kids</p>
          </div>
          <div className="flex gap-2">
            <Link href="/settings"
              className="bg-white border border-gray-200 text-gray-500 px-2.5 py-2 rounded-xl text-sm hover:bg-gray-50 transition-colors"
              title="Settings">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </Link>
            <Link href="/children"
              className="bg-white border border-gray-200 text-gray-600 font-medium px-3 py-2 rounded-xl text-sm hover:bg-gray-50 transition-colors">
              👧 Kids
            </Link>
            <Link href="/books/new"
              className="bg-amber-500 hover:bg-amber-600 text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors">
              + Book
            </Link>
          </div>
        </div>

        <HomeClient
          books={books.map(b => ({
            id: b.id,
            title: b.title,
            language: b.language,
            audioUrl: b.audioUrl,
            pageCount: b._count.pages,
            coverPath: b.pages[0]?.imagePath ?? null,
            progress: b.progress,
          }))}
          children={children}
        />
      </div>
    </main>
  )
}
