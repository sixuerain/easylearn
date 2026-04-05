'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Book {
  id: string; title: string; language: string; audioUrl: string | null
  pageCount: number; coverPath: string | null
  progress: { childId: string; pageIdx: number }[]
}
interface Child { id: string; name: string; color: string }

const STORAGE_KEY = 'easylearn_child'

export default function HomeClient({ books, children }: { books: Book[]; children: Child[] }) {
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && children.some(c => c.id === saved)) setSelectedChildId(saved)
  }, [children])

  function selectChild(id: string) {
    const next = selectedChildId === id ? null : id
    setSelectedChildId(next)
    if (next) localStorage.setItem(STORAGE_KEY, next)
    else localStorage.removeItem(STORAGE_KEY)
  }

  const selectedChild = children.find(c => c.id === selectedChildId) ?? null

  if (books.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow p-10 text-center">
        <p className="text-5xl mb-3">📚</p>
        <p className="text-gray-500 mb-5">No books yet.</p>
        <Link href="/books/new"
          className="inline-block bg-amber-500 hover:bg-amber-600 text-white font-semibold px-6 py-3 rounded-xl transition-colors">
          Add Your First Book
        </Link>
      </div>
    )
  }

  return (
    <div>
      {/* Child picker */}
      {children.length > 0 && (
        <div className="mb-5">
          <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Who&apos;s reading?</p>
          <div className="flex gap-2 flex-wrap">
            {children.map(child => (
              <button key={child.id} onClick={() => selectChild(child.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-full border-2 transition-all font-medium text-sm ${
                  selectedChildId === child.id
                    ? 'text-white border-transparent shadow-md scale-105'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
                style={selectedChildId === child.id ? { backgroundColor: child.color, borderColor: child.color } : {}}>
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                  style={{ backgroundColor: child.color }}>
                  {child.name[0].toUpperCase()}
                </span>
                {child.name}
              </button>
            ))}
            <Link href="/children"
              className="flex items-center gap-1 px-3 py-2 rounded-full border-2 border-dashed border-gray-300 text-gray-400 text-sm hover:border-gray-400 transition-colors">
              + Add kid
            </Link>
          </div>
        </div>
      )}

      {/* Book grid */}
      <div className="grid grid-cols-2 gap-3">
        {books.map(book => {
          const prog = selectedChild ? book.progress.find(p => p.childId === selectedChild.id) : null
          const pageIdx = prog?.pageIdx ?? 0
          const readLink = selectedChild
            ? `/books/${book.id}/read?child=${selectedChild.id}`
            : `/books/${book.id}/read`

          return (
            <div key={book.id} className="bg-white rounded-2xl shadow overflow-hidden">
              <Link href={`/books/${book.id}`} className="block">
                <div className="relative aspect-[3/4] bg-amber-100">
                  {book.coverPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={book.coverPath} alt={book.title} className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-5xl">📖</div>
                  )}
                  {book.audioUrl && (
                    <div className="absolute top-2 right-2 bg-green-500 text-white text-xs px-1.5 py-0.5 rounded-full">🔊</div>
                  )}
                  {/* Progress badge */}
                  {selectedChild && prog && book.pageCount > 0 && (
                    <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur text-white text-xs px-2 py-0.5 rounded-full">
                      p.{pageIdx + 1}/{book.pageCount}
                    </div>
                  )}
                </div>
                <div className="px-3 pt-2 pb-1">
                  <p className="font-semibold text-gray-800 text-sm truncate">{book.title}</p>
                  <p className="text-xs text-gray-400">
                    {book.pageCount === 0 ? 'No pages' : `${book.pageCount} page${book.pageCount !== 1 ? 's' : ''}`}
                  </p>
                </div>
              </Link>
              {book.pageCount > 0 && (
                <div className="px-3 pb-3">
                  <Link href={readLink}
                    className="block w-full text-center bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold py-1.5 rounded-lg transition-colors">
                    {selectedChild && prog ? `▶ Continue p.${pageIdx + 1}` : '▶ Read'}
                  </Link>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
