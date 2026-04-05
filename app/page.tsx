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
