'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'

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
  bookTitle: string
  bookLanguage: string
  createdAt: string
}

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

export default function PageManager({
  bookId,
  initialPages,
  audioUrl: initialAudioUrl,
  bookTitle,
  bookLanguage,
  createdAt,
}: Props) {
  const router = useRouter()
  const [pages, setPages] = useState<Page[]>(initialPages)
  const [audioUrl, setAudioUrl] = useState(initialAudioUrl)
  const [uploading, setUploading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [preview, setPreview] = useState<Page | null>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const addMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setPages(initialPages) }, [initialPages])
  useEffect(() => { setAudioUrl(initialAudioUrl) }, [initialAudioUrl])

  useEffect(() => {
    if (!addOpen) return
    function close(e: MouseEvent) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) setAddOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [addOpen])

  useEffect(() => {
    if (!preview) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [preview])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setPreview(null); setInfoOpen(false); setAddOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function uploadFile(file: File) {
    setUploading(true); setAddOpen(false)
    const formData = new FormData()
    formData.append('image', file)
    try {
      const res = await fetch(`/api/books/${bookId}/pages`, { method: 'POST', body: formData })
      if (res.ok) {
        const page = await res.json()
        setPages(prev => [...prev, { ...page, _count: { words: 0 } }])
        const bookRes = await fetch(`/api/books/${bookId}`)
        if (bookRes.ok) {
          const book = await bookRes.json()
          if (book.audioUrl && book.audioUrl !== audioUrl) {
            setAudioUrl(book.audioUrl)
            router.refresh()
          }
        }
      }
    } finally { setUploading(false) }
  }

  async function deleteManyIds(ids: string[]) {
    if (ids.length === 0) return
    if (!confirm(ids.length === 1 ? 'Delete this page?' : `Delete ${ids.length} pages?`)) return
    setDeleting(true)
    try {
      const sorted = [...pages].filter(p => ids.includes(p.id)).sort((a, b) => b.pageNum - a.pageNum)
      for (const p of sorted) {
        const res = await fetch(`/api/books/${bookId}/pages/${p.id}`, { method: 'DELETE' })
        if (!res.ok) break
      }
      setSelected(new Set())
      router.refresh()
    } finally { setDeleting(false) }
  }

  function toggleSelect(pageId: string) {
    setSelected(s => { const n = new Set(s); n.has(pageId) ? n.delete(pageId) : n.add(pageId); return n })
  }

  return (
    <div className="sketch-container">
      {/* Hidden file inputs */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />
      <input ref={galleryRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />

      {/* Page grid with notebook style */}
      {pages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-stone-400">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 opacity-40">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M12 8v8M8 12h8" />
          </svg>
          <p className="text-base font-hand">No pages yet</p>
          <p className="text-sm font-hand mt-1">Tap + to add one</p>
        </div>
      ) : (
        <>
          {/* Compact header bar */}
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-stone-400 font-hand">{pages.length} page{pages.length !== 1 ? 's' : ''}</p>
            <div className="flex items-center gap-2">
              {selected.size > 0 && (
                <button
                  type="button"
                  onClick={() => deleteManyIds([...selected])}
                  disabled={deleting}
                  className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40 transition-colors"
                >
                  Delete {selected.size}
                </button>
              )}
              <button
                type="button"
                onClick={() => setInfoOpen(true)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
                aria-label="Book information"
                title="Book info"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4M12 8h.01" />
                </svg>
              </button>
            </div>
          </div>

          {/* Page grid — 3 columns, compact cards */}
          <div className="grid grid-cols-3 gap-2.5">
            {pages.map(page => {
              const isSelected = selected.has(page.id)
              return (
                <div key={page.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => setPreview(page)}
                    className={`
                      w-full rounded-xl overflow-hidden transition-all duration-150
                      bg-white shadow-sm hover:shadow-md
                      ${isSelected
                        ? 'ring-2 ring-amber-400 ring-offset-1 shadow-amber-100'
                        : 'ring-1 ring-stone-200/70 hover:ring-stone-300'}
                    `}
                  >
                    {/* Thumbnail */}
                    <div className="aspect-[3/4] bg-stone-50 overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={page.imagePath}
                        alt={`Page ${page.pageNum}`}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    {/* Label strip */}
                    <div className="px-2 py-1.5 flex items-center justify-between gap-1 bg-white">
                      <span className="text-xs text-stone-500 font-hand truncate">
                        P{page.pageNum}
                      </span>
                      {page._count.words > 0 && (
                        <span className="text-[10px] text-stone-400 font-hand">
                          {page._count.words}w
                        </span>
                      )}
                    </div>
                  </button>
                  {/* Selection checkbox — top-left corner overlay */}
                  <div
                    className={`
                      absolute top-1.5 left-1.5 transition-opacity
                      ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
                    `}
                  >
                    <label className="flex h-5 w-5 items-center justify-center rounded-md bg-white/90 shadow-sm backdrop-blur cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(page.id)}
                        className="rounded border-stone-300 text-amber-500 focus:ring-amber-400 h-3.5 w-3.5"
                      />
                    </label>
                  </div>
                </div>
              )
            })}

            {/* Add page card — same size as page cards */}
            <div className="relative" ref={addMenuRef}>
              <button
                type="button"
                onClick={() => setAddOpen(o => !o)}
                disabled={uploading || deleting}
                className="
                  w-full rounded-xl overflow-hidden transition-all duration-150
                  border-2 border-dashed border-stone-200 hover:border-amber-400
                  bg-stone-50/50 hover:bg-amber-50/50
                  disabled:opacity-40
                "
                aria-expanded={addOpen}
                aria-haspopup="true"
                aria-label={uploading ? 'Adding page' : 'Add page'}
              >
                <div className="aspect-[3/4] flex flex-col items-center justify-center">
                  {uploading ? (
                    <span className="text-stone-400 text-sm animate-pulse">Adding...</span>
                  ) : (
                    <>
                      <span className="text-3xl text-stone-300 font-hand leading-none mb-1">+</span>
                      <span className="text-xs text-stone-400 font-hand">add page</span>
                    </>
                  )}
                </div>
                <div className="px-2 py-1.5 bg-transparent" />
              </button>
              {addOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-xl border border-stone-200 bg-white py-0.5 shadow-lg">
                  <button
                    type="button"
                    className="w-full px-3 py-2.5 text-left text-xs text-stone-700 hover:bg-amber-50 transition-colors"
                    onClick={() => { cameraRef.current?.click(); setAddOpen(false) }}
                  >
                    Camera
                  </button>
                  <button
                    type="button"
                    className="w-full px-3 py-2.5 text-left text-xs text-stone-700 hover:bg-amber-50 transition-colors border-t border-stone-100"
                    onClick={() => { galleryRef.current?.click(); setAddOpen(false) }}
                  >
                    Gallery
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Info dialog */}
      {infoOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/30 backdrop-blur-sm"
          role="dialog" aria-modal="true" aria-labelledby="book-info-title"
          onClick={() => setInfoOpen(false)}
        >
          <div className="w-full max-w-xs rounded-2xl bg-white/95 backdrop-blur p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 id="book-info-title" className="text-lg font-bold text-stone-800 mb-3 font-hand">Book Info</h2>
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between">
                <dt className="text-stone-400">Title</dt>
                <dd className="text-stone-700 text-right">{bookTitle}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-stone-400">Language</dt>
                <dd className="text-stone-700 uppercase">{bookLanguage}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-stone-400">Created</dt>
                <dd className="text-stone-700">{formatDate(createdAt)}</dd>
              </div>
              <div className="flex justify-between items-start">
                <dt className="text-stone-400">Audio</dt>
                <dd className="text-right">
                  {audioUrl
                    ? <span className="text-green-600 text-xs">Linked via QR</span>
                    : <span className="text-stone-400 text-xs italic">Not linked</span>
                  }
                </dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={() => setInfoOpen(false)}
              className="mt-4 w-full py-2 rounded-xl text-xs font-medium bg-stone-100 text-stone-600 hover:bg-stone-200 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Full-screen preview */}
      {preview && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-black/95"
          role="dialog" aria-modal="true" aria-label={`Page ${preview.pageNum} preview`}
        >
          <div className="flex items-center justify-between px-4 py-3 text-white/80">
            <span className="text-base font-hand">Page {preview.pageNum}</span>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="text-sm text-white/60 hover:text-white transition-colors"
            >
              Close
            </button>
          </div>
          <div
            className="flex-1 flex items-center justify-center p-3 min-h-0 cursor-zoom-out"
            onClick={() => setPreview(null)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview.imagePath}
              alt={`Page ${preview.pageNum}`}
              className="max-h-full max-w-full object-contain rounded-lg"
              onClick={e => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  )
}
