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

  useEffect(() => {
    setPages(initialPages)
  }, [initialPages])

  useEffect(() => {
    setAudioUrl(initialAudioUrl)
  }, [initialAudioUrl])

  useEffect(() => {
    if (!addOpen) return
    function close(e: MouseEvent) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [addOpen])

  useEffect(() => {
    if (!preview) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [preview])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setPreview(null)
      setInfoOpen(false)
      setAddOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function uploadFile(file: File) {
    setUploading(true)
    setAddOpen(false)
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
    } finally {
      setUploading(false)
    }
  }

  async function deleteManyIds(ids: string[]) {
    if (ids.length === 0) return
    const msg =
      ids.length === 1
        ? 'Delete this page?'
        : `Delete ${ids.length} pages?`
    if (!confirm(msg)) return
    setDeleting(true)
    try {
      const sorted = [...pages]
        .filter(p => ids.includes(p.id))
        .sort((a, b) => b.pageNum - a.pageNum)
      for (const p of sorted) {
        const res = await fetch(`/api/books/${bookId}/pages/${p.id}`, { method: 'DELETE' })
        if (!res.ok) break
      }
      setSelected(new Set())
      router.refresh()
    } finally {
      setDeleting(false)
    }
  }

  function toggleSelect(pageId: string) {
    setSelected(s => {
      const n = new Set(s)
      if (n.has(pageId)) n.delete(pageId)
      else n.add(pageId)
      return n
    })
  }

  function deleteSelected() {
    deleteManyIds([...selected])
  }

  return (
    <div>
      <div className="flex items-center justify-end mb-4">
        <button
          type="button"
          onClick={() => setInfoOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-500 shadow-sm hover:bg-stone-50 hover:text-stone-800 transition-colors"
          aria-label="Book information"
          title="Book information"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
        </button>
      </div>

      {infoOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="book-info-title"
          onClick={() => setInfoOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <h2 id="book-info-title" className="text-lg font-semibold text-stone-900 mb-4">
              Book info
            </h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-stone-400">Title</dt>
                <dd className="text-stone-800 mt-0.5">{bookTitle}</dd>
              </div>
              <div>
                <dt className="text-stone-400">Language</dt>
                <dd className="text-stone-800 mt-0.5 uppercase">{bookLanguage}</dd>
              </div>
              <div>
                <dt className="text-stone-400">Created</dt>
                <dd className="text-stone-800 mt-0.5">{formatDate(createdAt)}</dd>
              </div>
              <div>
                <dt className="text-stone-400">Audio (QR)</dt>
                <dd className="text-stone-800 mt-0.5 break-all">
                  {audioUrl ? (
                    <>
                      <span className="text-green-700">Linked from a scanned QR code.</span>
                      <span className="block text-xs text-stone-500 mt-2 font-mono">{audioUrl}</span>
                    </>
                  ) : (
                    <span className="text-stone-500">Not linked yet. Photograph a page that shows the book&apos;s QR code.</span>
                  )}
                </dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={() => setInfoOpen(false)}
              className="mt-6 w-full py-2.5 rounded-xl text-sm font-medium bg-stone-100 text-stone-800 hover:bg-stone-200 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />
      <input ref={galleryRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />

      <div className="relative flex justify-center mb-6" ref={addMenuRef}>
        <button
          type="button"
          onClick={() => setAddOpen(o => !o)}
          disabled={uploading || deleting}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500 text-white text-2xl font-light shadow-md hover:bg-amber-600 disabled:opacity-50 transition-colors"
          aria-expanded={addOpen}
          aria-haspopup="true"
          aria-label={uploading ? 'Adding page' : 'Add page'}
        >
          {uploading ? '…' : '+'}
        </button>
        {addOpen && (
          <div className="absolute top-full mt-2 z-20 w-52 rounded-xl border border-stone-200 bg-white py-1 shadow-lg">
            <button
              type="button"
              className="w-full px-4 py-3 text-left text-sm text-stone-800 hover:bg-stone-50"
              onClick={() => { cameraRef.current?.click(); setAddOpen(false) }}
            >
              Take photo
            </button>
            <button
              type="button"
              className="w-full px-4 py-3 text-left text-sm text-stone-800 hover:bg-stone-50 border-t border-stone-100"
              onClick={() => { galleryRef.current?.click(); setAddOpen(false) }}
            >
              Choose from gallery
            </button>
          </div>
        )}
      </div>

      {pages.length === 0 ? (
        <p className="text-center text-sm text-stone-400 py-12">No pages yet. Tap + to add one.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium text-stone-600">Pages</h2>
            <span className="text-xs text-stone-400">{pages.length} total</span>
          </div>

          <div className="rounded-xl border border-stone-200 bg-white divide-y divide-stone-100 max-h-[min(52vh,24rem)] overflow-y-auto">
            {pages.map(page => (
              <div key={page.id} className="flex items-stretch gap-3 px-3 py-3">
                <div className="flex items-start pt-1">
                  <input
                    type="checkbox"
                    checked={selected.has(page.id)}
                    onChange={() => toggleSelect(page.id)}
                    onClick={e => e.stopPropagation()}
                    className="rounded border-stone-300 text-amber-600 focus:ring-amber-500 mt-1"
                    aria-label={`Select page ${page.pageNum}`}
                  />
                </div>
                <button
                  type="button"
                  className="flex flex-1 min-w-0 gap-3 text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                  onClick={() => setPreview(page)}
                >
                  <div className="h-36 w-28 shrink-0 rounded-lg bg-stone-100 overflow-hidden ring-1 ring-stone-200/80">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={page.imagePath} alt={`Page ${page.pageNum}`} className="h-full w-full object-cover" />
                  </div>
                  <div className="flex flex-col justify-center min-w-0 py-0.5">
                    <p className="text-sm font-medium text-stone-800">Page {page.pageNum}</p>
                    {page._count.words > 0 && (
                      <p className="text-xs text-stone-400 mt-1">{page._count.words} words</p>
                    )}
                  </div>
                </button>
              </div>
            ))}
          </div>

          {selected.size > 0 && (
            <button
              type="button"
              onClick={deleteSelected}
              disabled={deleting}
              className="w-full py-2.5 rounded-xl text-sm font-medium bg-stone-800 text-white hover:bg-stone-900 disabled:opacity-50 transition-colors"
            >
              Delete selected ({selected.size})
            </button>
          )}
        </div>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-black"
          role="dialog"
          aria-modal="true"
          aria-label={`Page ${preview.pageNum} preview`}
        >
          <div className="flex items-center justify-between px-3 py-3 text-white bg-black/60">
            <span className="text-sm font-medium">Page {preview.pageNum}</span>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="rounded-lg px-3 py-1.5 text-sm bg-white/10 hover:bg-white/20"
            >
              Close
            </button>
          </div>
          <div
            className="flex-1 flex items-center justify-center p-2 min-h-0 w-full cursor-zoom-out"
            onClick={() => setPreview(null)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview.imagePath}
              alt={`Page ${preview.pageNum}`}
              className="max-h-full max-w-full object-contain"
              onClick={e => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  )
}
