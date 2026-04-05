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
    <main className="min-h-screen bg-[#faf8f5] p-4 pb-12">
      <div className="max-w-lg mx-auto">
        {/* Compact header */}
        <header className="flex items-center gap-2 mb-5 pt-1">
          <Link href="/" className="text-stone-400 hover:text-stone-600 transition-colors" aria-label="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
          <h1 className="flex-1 text-xl font-bold text-stone-800 truncate font-hand">{book.title}</h1>
          <div className="flex items-center gap-1.5 shrink-0">
            <DeleteBookButton bookId={id} />
            {book.pages.length > 0 && book.audioUrl && (
              <Link
                href={`/books/${id}/sync`}
                className="text-xs font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 px-2.5 py-1.5 rounded-lg transition-colors"
              >
                Sync
              </Link>
            )}
            {book.pages.length > 0 && (
              <Link
                href={`/books/${id}/read`}
                className="text-xs font-medium text-white bg-amber-500 hover:bg-amber-600 px-2.5 py-1.5 rounded-lg transition-colors"
              >
                Read
              </Link>
            )}
          </div>
        </header>

        <PageManager
          bookId={id}
          initialPages={book.pages}
          audioUrl={book.audioUrl}
          bookTitle={book.title}
          bookLanguage={book.language}
          createdAt={book.createdAt.toISOString()}
        />
      </div>
    </main>
  )
}
