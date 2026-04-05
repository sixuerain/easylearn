'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function DeleteBookButton({ bookId }: { bookId: string }) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!confirm('Delete this book? All pages, words, and timings will be lost.')) return
    setDeleting(true)
    await fetch(`/api/books/${bookId}`, { method: 'DELETE' })
    router.push('/')
  }

  return (
    <button onClick={handleDelete} disabled={deleting}
      className="text-gray-400 hover:text-red-500 disabled:opacity-40 transition-colors px-2 py-1 rounded-lg text-xl"
      title="Delete book">
      {deleting ? '…' : '🗑'}
    </button>
  )
}
