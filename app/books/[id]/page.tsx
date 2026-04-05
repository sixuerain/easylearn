import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import PageManager from './PageManager'
import DeleteBookButton from './DeleteBookButton'

export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const { id } = await params
  const book = await prisma.book.findUnique({
    where: { id },
    include: {
      pages: {
        orderBy: { pageNum: 'asc' },
        include: { _count: { select: { words: true } } },
      },
    },
  })

  if (!book) notFound()

  return (
    <main className="min-h-screen bg-amber-50 p-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5 pt-2">
          <Link href="/" className="text-amber-600 text-2xl leading-none">←</Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-800 truncate">{book.title}</h1>
            <p className="text-xs text-gray-400 uppercase tracking-wide">{book.language} · {book.pages.length} pages</p>
          </div>
          <DeleteBookButton bookId={id} />
          {book.pages.length > 0 && (
            <div className="flex gap-2">
              {book.audioUrl && (
                <Link href={`/books/${id}/sync`}
                  className="bg-blue-500 hover:bg-blue-600 text-white font-semibold px-3 py-2 rounded-xl text-sm whitespace-nowrap transition-colors">
                  🎵 Sync
                </Link>
              )}
              <Link href={`/books/${id}/read`}
                className="bg-amber-500 hover:bg-amber-600 text-white font-semibold px-3 py-2 rounded-xl text-sm whitespace-nowrap transition-colors">
                ▶ Read
              </Link>
            </div>
          )}
        </div>

        <PageManager bookId={id} initialPages={book.pages} audioUrl={book.audioUrl} />
      </div>
    </main>
  )
}
