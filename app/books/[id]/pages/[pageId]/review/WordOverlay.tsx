'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'

interface Word {
  id: string
  text: string
  x: number
  y: number
  w: number
  h: number
  orderIdx: number
}

interface Props {
  bookId: string
  pageId: string
  imagePath: string
  initialWords: Word[]
  pageNum: number
}

export default function WordOverlay({ bookId, pageId, imagePath, initialWords, pageNum }: Props) {
  const [words, setWords] = useState<Word[]>(initialWords)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('')
  const editRef = useRef<HTMLInputElement>(null)

  const selected = words.find(w => w.id === selectedId) ?? null

  function selectWord(word: Word) {
    setSelectedId(word.id)
    setEditText(word.text)
    setTimeout(() => editRef.current?.focus(), 50)
  }

  async function runOcr() {
    setRunning(true)
    setStatus('Running OCR… (may take 10–20s on first run)')
    setSelectedId(null)
    try {
      const res = await fetch(`/api/books/${bookId}/pages/${pageId}/ocr`, { method: 'POST' })
      if (res.ok) {
        const updated: Word[] = await res.json()
        setWords(updated)
        setStatus(`Done — ${updated.length} words found`)
      } else {
        setStatus('OCR failed. Try again.')
      }
    } catch {
      setStatus('OCR error. Try again.')
    } finally {
      setRunning(false)
    }
  }

  async function saveEdit() {
    if (!selected || !editText.trim()) return
    const res = await fetch(`/api/books/${bookId}/pages/${pageId}/words/${selected.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: editText.trim() }),
    })
    if (res.ok) {
      setWords(prev => prev.map(w => w.id === selected.id ? { ...w, text: editText.trim() } : w))
      setSelectedId(null)
    }
  }

  async function deleteWord() {
    if (!selected) return
    const res = await fetch(`/api/books/${bookId}/pages/${pageId}/words/${selected.id}`, {
      method: 'DELETE',
    })
    if (res.ok) {
      setWords(prev => prev.filter(w => w.id !== selected.id).map((w, i) => ({ ...w, orderIdx: i })))
      setSelectedId(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-900 border-b border-gray-800">
        <Link href={`/books/${bookId}`} className="text-gray-300 hover:text-white text-xl">←</Link>
        <div className="flex-1">
          <p className="text-white font-medium text-sm">Page {pageNum} — OCR Review</p>
          <p className="text-gray-400 text-xs">{words.length} words detected</p>
        </div>
        <button
          onClick={runOcr}
          disabled={running}
          className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
        >
          {running ? 'Running…' : '🔍 Run OCR'}
        </button>
      </div>

      {/* Status bar */}
      {status && (
        <div className="bg-blue-900/50 text-blue-200 text-xs px-4 py-2 text-center">
          {status}
        </div>
      )}

      {/* Image + overlay */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="relative w-full" onClick={() => setSelectedId(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imagePath}
            alt={`Page ${pageNum}`}
            className="w-full block rounded-lg"
          />

          {/* Word boxes — positioned as % of image */}
          {words.map(word => (
            <div
              key={word.id}
              onClick={e => { e.stopPropagation(); selectWord(word) }}
              title={word.text}
              className={`absolute cursor-pointer border-2 rounded-sm transition-colors ${
                selectedId === word.id
                  ? 'border-orange-400 bg-orange-400/40'
                  : 'border-yellow-400/70 bg-yellow-400/15 hover:bg-yellow-400/30'
              }`}
              style={{
                left: `${word.x * 100}%`,
                top: `${word.y * 100}%`,
                width: `${word.w * 100}%`,
                height: `${word.h * 100}%`,
              }}
            />
          ))}
        </div>

        {words.length === 0 && !running && (
          <div className="mt-6 text-center text-gray-500 text-sm">
            <p>No words detected yet.</p>
            <p>Tap <strong>Run OCR</strong> to extract words from this page.</p>
          </div>
        )}
      </div>

      {/* Edit panel — slides up when word selected */}
      {selected && (
        <div className="bg-gray-900 border-t border-gray-700 p-3">
          <p className="text-gray-400 text-xs mb-2">Edit word text (tap box on image to select)</p>
          <div className="flex gap-2">
            <input
              ref={editRef}
              value={editText}
              onChange={e => setEditText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveEdit()}
              className="flex-1 bg-gray-800 text-white border border-gray-600 rounded-lg px-3 py-2 text-base focus:outline-none focus:border-amber-500"
            />
            <button
              onClick={saveEdit}
              className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg font-semibold"
            >✓</button>
            <button
              onClick={deleteWord}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-semibold"
            >✕</button>
          </div>
        </div>
      )}

      {/* Word list strip (scrollable, tappable) */}
      {words.length > 0 && (
        <div className="bg-gray-900 border-t border-gray-800 px-3 py-2">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {words.map(word => (
              <button
                key={word.id}
                onClick={() => selectWord(word)}
                className={`flex-shrink-0 text-xs px-2 py-1 rounded border transition-colors ${
                  selectedId === word.id
                    ? 'border-orange-400 bg-orange-400/20 text-orange-300'
                    : 'border-gray-600 bg-gray-800 text-gray-300 hover:border-gray-400'
                }`}
              >
                {word.text}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
