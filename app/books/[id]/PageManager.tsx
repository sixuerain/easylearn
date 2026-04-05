'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'

interface Page {
  id: string
  pageNum: number
  imagePath: string
  _count: { words: number }
}

interface Props {
  bookId: string
  initialPages: Page[]
  audioUrl: string | null
}

export default function PageManager({ bookId, initialPages, audioUrl: initialAudioUrl }: Props) {
  const [pages, setPages] = useState<Page[]>(initialPages)
  const [audioUrl, setAudioUrl] = useState(initialAudioUrl)
  const [uploading, setUploading] = useState(false)
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  async function uploadFile(file: File) {
    setUploading(true)
    const formData = new FormData()
    formData.append('image', file)
    try {
      const res = await fetch(`/api/books/${bookId}/pages`, { method: 'POST', body: formData })
      if (res.ok) {
        const page = await res.json()
        setPages(prev => [...prev, { ...page, _count: { words: 0 } }])
        // Check if QR was detected
        const bookRes = await fetch(`/api/books/${bookId}`)
        if (bookRes.ok) {
          const book = await bookRes.json()
          if (book.audioUrl && book.audioUrl !== audioUrl) setAudioUrl(book.audioUrl)
        }
      }
    } finally {
      setUploading(false)
    }
  }

  async function deletePage(pageId: string) {
    if (!confirm('Delete this page?')) return
    const res = await fetch(`/api/books/${bookId}/pages/${pageId}`, { method: 'DELETE' })
    if (res.ok) {
      setPages(prev => prev.filter(p => p.id !== pageId).map((p, i) => ({ ...p, pageNum: i + 1 })))
    }
  }

  async function movePage(pageId: string, direction: 'up' | 'down') {
    const res = await fetch(`/api/books/${bookId}/pages/${pageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction }),
    })
    if (res.ok) {
      const updated: Omit<Page, '_count'>[] = await res.json()
      setPages(prev => {
        const countMap = Object.fromEntries(prev.map(p => [p.id, p._count]))
        return updated.map(p => ({ ...p, _count: countMap[p.id] ?? { words: 0 } }))
      })
    }
  }

  return (
    <div>
      {/* Audio URL status */}
      {audioUrl ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-4 flex items-start gap-2">
          <span className="text-green-600 text-lg">🔊</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-green-700">Audio linked from QR code</p>
            <p className="text-xs text-green-600 truncate">{audioUrl}</p>
          </div>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-xs text-amber-700">
          📷 Upload a page with a QR code to link the book&apos;s audio automatically.
        </div>
      )}

      {/* Upload buttons */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />
      <input ref={galleryRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />

      <div className="flex gap-2 mb-5">
        <button onClick={() => cameraRef.current?.click()} disabled={uploading}
          className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-semibold py-3.5 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 transition-colors">
          {uploading ? 'Uploading…' : '📷 Take Photo'}
        </button>
        <button onClick={() => galleryRef.current?.click()} disabled={uploading}
          className="flex-1 bg-white hover:bg-gray-50 text-gray-700 font-semibold py-3.5 rounded-xl border border-gray-200 flex items-center justify-center gap-2 disabled:opacity-50 transition-colors">
          🖼 Gallery
        </button>
      </div>

      {/* Page grid */}
      {pages.length === 0 ? (
        <div className="bg-white rounded-2xl shadow p-10 text-center">
          <p className="text-4xl mb-3">📄</p>
          <p className="text-gray-400 text-sm">No pages yet.<br />Photograph your book pages above.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {pages.map((page, idx) => (
            <div key={page.id} className="bg-white rounded-xl shadow overflow-hidden">
              <div className="relative aspect-[3/4] bg-gray-100">
                <Image src={page.imagePath} alt={`Page ${page.pageNum}`} fill
                  className="object-cover" sizes="(max-width: 640px) 50vw, 300px" />
                {/* Page number badge */}
                <div className="absolute top-1.5 left-1.5 bg-black/50 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                  {page.pageNum}
                </div>
                {/* OCR status badge */}
                <div className={`absolute top-1.5 right-1.5 text-xs font-bold px-1.5 py-0.5 rounded-full ${
                  page._count.words > 0
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-700/70 text-gray-300'
                }`}>
                  {page._count.words > 0 ? `${page._count.words}w` : 'OCR?'}
                </div>
              </div>
              <div className="flex items-center justify-between px-2 py-1.5">
                <div className="flex gap-0.5">
                  <button onClick={() => movePage(page.id, 'up')} disabled={idx === 0}
                    className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-700 disabled:opacity-25 rounded">↑</button>
                  <button onClick={() => movePage(page.id, 'down')} disabled={idx === pages.length - 1}
                    className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-700 disabled:opacity-25 rounded">↓</button>
                </div>
                <Link href={`/books/${bookId}/pages/${page.id}/review`}
                  className="text-xs text-blue-500 hover:text-blue-700 px-1.5 py-1 rounded font-medium">
                  Review
                </Link>
                <button onClick={() => deletePage(page.id)}
                  className="w-7 h-7 flex items-center justify-center text-red-400 hover:text-red-600 rounded text-sm">✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
