'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function NewBookPage() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [language, setLanguage] = useState('en')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const res = await fetch('/api/books', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, language }),
    })
    if (res.ok) {
      const book = await res.json()
      router.push(`/books/${book.id}`)
    } else {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-amber-50 p-4">
      <div className="max-w-sm mx-auto">
        <div className="flex items-center gap-3 mb-6 pt-2">
          <Link href="/" className="text-amber-600 text-2xl leading-none">←</Link>
          <h1 className="text-2xl font-bold text-gray-800">New Book</h1>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Book Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              placeholder="e.g. The Very Hungry Caterpillar"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
            <select
              value={language}
              onChange={e => setLanguage(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
            >
              <option value="en">English</option>
              <option value="zh">Chinese</option>
              <option value="ja">Japanese</option>
              <option value="ko">Korean</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={loading || !title.trim()}
            className="w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold py-3 rounded-xl text-base disabled:opacity-50 transition-colors"
          >
            {loading ? 'Creating…' : 'Create Book'}
          </button>
        </form>
      </div>
    </main>
  )
}
