import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import ChildrenManager from './ChildrenManager'

export default async function ChildrenPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const children = await prisma.child.findMany({ orderBy: { createdAt: 'asc' } })

  return (
    <main className="min-h-screen bg-amber-50 p-4">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-6 pt-2">
          <Link href="/" className="text-amber-600 text-2xl leading-none">←</Link>
          <h1 className="text-2xl font-bold text-gray-800 flex-1">Kids Profiles</h1>
        </div>
        <ChildrenManager initialChildren={children} />
      </div>
    </main>
  )
}
