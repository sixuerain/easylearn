import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import Image from 'next/image'

export default async function Home() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const books = await prisma.book.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      pages: { orderBy: { pageNum: 'asc' }, take: 1 },
      _count: { select: { pages: true } },
    },
  })

  return (
    <main className="min-h-screen bg-amber-50 p-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 pt-2">
          <div>
            <h1 className="text-3xl font-bold text-amber-600">EasyLearn</h1>
            <p className="text-xs text-gray-400">Read along with your kids</p>
          </div>
          <Link
            href="/books/new"
            className="bg-amber-500 hover:bg-amber-600 text-white font-semibold px-4 py-2.5 rounded-xl text-sm transition-colors"
          >
            + New Book
          </Link>
        </div>

        {books.length === 0 ? (
          <div className="bg-white rounded-2xl shadow p-10 text-center">
            <p className="text-5xl mb-3">📚</p>
            <p className="text-gray-500 mb-5">No books yet.</p>
            <Link
              href="/books/new"
              className="inline-block bg-amber-500 hover:bg-amber-600 text-white font-semibold px-6 py-3 rounded-xl transition-colors"
            >
              Add Your First Book
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {books.map(book => (
              <Link
                key={book.id}
                href={`/books/${book.id}`}
                className="bg-white rounded-2xl shadow overflow-hidden active:scale-95 transition-transform"
              >
                <div className="relative aspect-[3/4] bg-amber-100">
                  {book.pages[0] ? (
                    <Image
                      src={book.pages[0].imagePath}
                      alt={book.title}
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 50vw, 300px"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-5xl">📖</div>
                  )}
                  {book.audioUrl && (
                    <div className="absolute top-2 right-2 bg-green-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                      🔊
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <p className="font-semibold text-gray-800 text-sm truncate">{book.title}</p>
                  <p className="text-xs text-gray-400">
                    {book._count.pages === 0 ? 'No pages' : `${book._count.pages} page${book._count.pages > 1 ? 's' : ''}`}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
