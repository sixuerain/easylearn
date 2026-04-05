'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface BookmarkWord {
  wordId: string; text: string; imagePath: string
  pageNum: number; bookId: string; hasTiming: boolean
}

interface Props {
  childId: string
  childName: string
  bookmarks: BookmarkWord[]
}

export default function NewPlanForm({ childId, childName, bookmarks }: Props) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  function toggle(wordId: string) {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(wordId) ? n.delete(wordId) : n.add(wordId)
      return n
    })
  }

  function selectAll() { setSelected(new Set(bookmarks.map(b => b.wordId))) }
  function selectNone() { setSelected(new Set()) }

  async function create() {
    if (!name.trim() || selected.size === 0) return
    setSaving(true)
    const wordIds = bookmarks.filter(b => selected.has(b.wordId)).map(b => b.wordId)
    const res = await fetch(`/api/children/${childId}/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, wordIds }),
    })
    const plan = await res.json()
    router.push(`/children/${childId}/plans/${plan.id}`)
  }

  return (
    <main className="min-h-screen bg-amber-50 p-4">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-6 pt-2">
          <Link href={`/children/${childId}`} className="text-amber-600 text-2xl leading-none">←</Link>
          <h1 className="text-2xl font-bold text-gray-800 flex-1">New Exercise Plan</h1>
        </div>

        {/* Plan name */}
        <input
          type="text"
          placeholder="Plan name (e.g. Week 1 words)"
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full border border-gray-200 bg-white rounded-2xl px-4 py-3 mb-4 text-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-400 text-lg"
        />

        {/* Word selection */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-700">
              Choose words <span className="text-gray-400 font-normal">({selected.size}/{bookmarks.length})</span>
            </h2>
            <div className="flex gap-2">
              <button onClick={selectAll} className="text-xs text-amber-600 hover:underline">All</button>
              <button onClick={selectNone} className="text-xs text-gray-400 hover:underline">None</button>
            </div>
          </div>

          {bookmarks.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-4">
              No bookmarks yet — ⭐ star words while reading first.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {bookmarks.map(bm => (
                <button
                  key={bm.wordId}
                  onClick={() => toggle(bm.wordId)}
                  className={`px-3 py-1.5 rounded-full border-2 text-sm font-medium transition-all ${
                    selected.has(bm.wordId)
                      ? 'bg-amber-500 border-amber-500 text-white'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-amber-300'
                  }`}>
                  {bm.text}
                  {!bm.hasTiming && <span className="ml-1 text-xs opacity-60">(no audio)</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={create}
          disabled={!name.trim() || selected.size === 0 || saving}
          className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white py-3 rounded-2xl font-bold text-lg transition-colors">
          {saving ? 'Creating…' : `Create Plan (${selected.size} words)`}
        </button>
      </div>
    </main>
  )
}
