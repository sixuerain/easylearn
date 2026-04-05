import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function Home() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  return (
    <main className="min-h-screen bg-amber-50 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-amber-600">EasyLearn</h1>
            <p className="text-gray-500 text-sm mt-1">Welcome, {session.user?.name}</p>
          </div>
          <Link
            href="/books/new"
            className="bg-amber-500 hover:bg-amber-600 text-white font-semibold px-5 py-2.5 rounded-xl text-sm"
          >
            + New Book
          </Link>
        </div>
        <div className="bg-white rounded-2xl shadow p-8 text-center">
          <p className="text-4xl mb-3">📚</p>
          <p className="text-gray-500">No books yet. Tap <strong>+ New Book</strong> to upload your first book.</p>
        </div>
      </div>
    </main>
  )
}
