'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface Timing { startMs: number; endMs: number }

interface Word {
  id: string
  text: string
  x: number; y: number; w: number; h: number
  orderIdx: number
  timing: Timing | null
}

interface PageData {
  id: string
  pageNum: number
  imagePath: string
  words: Word[]
}

interface Props {
  bookId: string
  audioUrl: string | null        // remote URL from QR
  localAudioPath: string | null  // locally downloaded copy
  pages: PageData[]
}

export default function SyncTool({ bookId, audioUrl, localAudioPath: initialLocal, pages }: Props) {
  // Flatten all words in reading order
  const allWords = pages.flatMap(p => p.words.map(w => ({ ...w, pageId: p.id, pageNum: p.pageNum })))

  const [timings, setTimings] = useState<Record<string, Timing>>(() => {
    const map: Record<string, Timing> = {}
    for (const w of allWords) if (w.timing) map[w.id] = w.timing
    return map
  })
  const [currentIdx, setCurrentIdx] = useState(() => {
    // Start at first un-stamped word
    const first = allWords.findIndex(w => !w.timing)
    return first === -1 ? 0 : first
  })
  const [speed, setSpeed] = useState(1)
  const [localPath, setLocalPath] = useState(initialLocal)
  const [downloading, setDownloading] = useState(false)
  const [downloadErr, setDownloadErr] = useState('')
  const [audioReady, setAudioReady] = useState(false)
  const [showCustomUrl, setShowCustomUrl] = useState(false)
  const [customUrlInput, setCustomUrlInput] = useState('')
  const [savingUrl, setSavingUrl] = useState(false)
  const [autoSyncing, setAutoSyncing] = useState(false)
  const [autoSyncMsg, setAutoSyncMsg] = useState('')
  const audioRef = useRef<HTMLAudioElement>(null)

  const currentWord = allWords[currentIdx] ?? null
  const currentPage = currentWord ? pages.find(p => p.id === currentWord.pageId) ?? pages[0] : pages[0]
  const stamped = Object.keys(timings).length
  const total = allWords.length

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed
  }, [speed])

  const nowMs = useCallback(() => Math.round((audioRef.current?.currentTime ?? 0) * 1000), [])

  async function saveTiming(wordId: string, startMs: number, endMs: number) {
    setTimings(prev => ({ ...prev, [wordId]: { startMs, endMs } }))
    await fetch(`/api/timings/${wordId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startMs, endMs }),
    })
  }

  async function handleMark() {
    if (!currentWord) return
    const ms = nowMs()

    // Close off previous word's endMs
    const prevWord = allWords[currentIdx - 1]
    if (prevWord && timings[prevWord.id]) {
      await saveTiming(prevWord.id, timings[prevWord.id].startMs, ms)
    }

    // Stamp current word (endMs is placeholder — updated when next word is marked)
    await saveTiming(currentWord.id, ms, ms + 2000)

    if (currentIdx < allWords.length - 1) {
      setCurrentIdx(i => i + 1)
    }
  }

  async function handleUndo() {
    if (currentIdx === 0) return
    const prevIdx = currentIdx - 1
    const prevWord = allWords[prevIdx]
    // Remove timing of previous word
    setTimings(prev => { const n = { ...prev }; delete n[prevWord.id]; return n })
    await fetch(`/api/timings/${prevWord.id}`, { method: 'DELETE' })
    setCurrentIdx(prevIdx)
    // Seek audio back
    if (audioRef.current && timings[prevWord.id]) {
      audioRef.current.currentTime = timings[prevWord.id].startMs / 1000
    }
  }

  async function downloadAudio() {
    setDownloading(true)
    setDownloadErr('')
    try {
      const res = await fetch(`/api/books/${bookId}/audio`, { method: 'POST' })
      const data = await res.json()
      if (data.localPath) setLocalPath(data.localPath)
      else {
        setDownloadErr(data.message ?? data.error ?? 'Download failed')
        if (data.error === 'streaming_page') setShowCustomUrl(true)
      }
    } catch {
      setDownloadErr('Network error')
    } finally {
      setDownloading(false)
    }
  }

  async function autoSync() {
    setAutoSyncing(true)
    setAutoSyncMsg('')
    try {
      const res = await fetch(`/api/books/${bookId}/autosync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = await res.json()
      if (data.ok) {
        setAutoSyncMsg(`✓ Auto-synced ${data.wordCount} words across ${(data.totalMs / 1000).toFixed(1)}s`)
        // Reload to show updated timings
        window.location.reload()
      } else {
        setAutoSyncMsg(`✗ ${data.error}`)
      }
    } catch {
      setAutoSyncMsg('✗ Network error')
    } finally {
      setAutoSyncing(false)
    }
  }

  async function saveCustomUrl() {
    const url = customUrlInput.trim()
    if (!url) return
    setSavingUrl(true)
    try {
      await fetch(`/api/books/${bookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioUrl: url }),
      })
      // Try to download and cache locally
      const res = await fetch(`/api/books/${bookId}/audio`, { method: 'POST' })
      const data = await res.json()
      if (data.localPath) {
        setLocalPath(data.localPath)
        setShowCustomUrl(false)
        setDownloadErr('')
      } else {
        // Use the URL directly for playback even if can't cache
        setDownloadErr(data.message ?? data.error ?? '')
      }
    } catch {
      setDownloadErr('Network error')
    } finally {
      setSavingUrl(false)
    }
  }

  // Keyboard shortcut: Space = mark, ← = undo
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return
      if (e.code === 'Space') { e.preventDefault(); handleMark() }
      if (e.code === 'ArrowLeft') { e.preventDefault(); handleUndo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const audioSrc = localPath ?? audioUrl ?? ''

  function wordStatus(w: typeof allWords[0], idx: number) {
    if (timings[w.id]) return 'stamped'
    if (idx === currentIdx) return 'current'
    return 'upcoming'
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col max-h-screen overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-900 border-b border-gray-800 flex-shrink-0">
        <Link href={`/books/${bookId}`} className="text-gray-300 text-xl">←</Link>
        <div className="flex-1">
          <p className="text-white font-medium text-sm">Audio Sync</p>
          <p className="text-gray-400 text-xs">{stamped}/{total} words stamped</p>
          {autoSyncMsg && <p className="text-xs mt-0.5" style={{ color: autoSyncMsg.startsWith('✓') ? '#86efac' : '#fca5a5' }}>{autoSyncMsg}</p>}
        </div>
        {localPath && total > 0 && (
          <button onClick={autoSync} disabled={autoSyncing}
            className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded-lg">
            {autoSyncing ? '⏳ Syncing…' : '⚡ Auto'}
          </button>
        )}
        {stamped === total && total > 0 && (
          <Link href={`/books/${bookId}/read`}
            className="bg-green-500 hover:bg-green-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg">
            ▶ Read
          </Link>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-gray-800 flex-shrink-0">
        <div className="h-full bg-amber-500 transition-all" style={{ width: `${total ? stamped / total * 100 : 0}%` }} />
      </div>

      {/* Audio source setup */}
      {!audioSrc && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="bg-gray-800 rounded-2xl p-6 text-center max-w-sm w-full">
            <p className="text-gray-400 text-sm mb-4">No audio linked to this book yet.<br />
              Upload a page with the book&apos;s QR code to auto-detect the audio URL.</p>
          </div>
        </div>
      )}

      {audioSrc && (
        <>
          {/* Page image + word overlays */}
          <div className="flex-1 overflow-y-auto p-3 min-h-0">
            <div className="relative w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={currentPage?.imagePath} alt={`Page ${currentPage?.pageNum}`}
                className="w-full block rounded-lg" />
              {currentPage?.words.map((word, _wi) => {
                const globalIdx = allWords.findIndex(w => w.id === word.id)
                const status = wordStatus(allWords[globalIdx], globalIdx)
                return (
                  <div key={word.id}
                    onClick={() => status !== 'stamped' && setCurrentIdx(globalIdx)}
                    className={`absolute border-2 rounded-sm cursor-pointer transition-all ${
                      status === 'stamped'  ? 'border-green-400/60 bg-green-400/20' :
                      status === 'current' ? 'border-orange-400 bg-orange-400/40 animate-pulse' :
                                             'border-yellow-400/50 bg-yellow-400/10'
                    }`}
                    style={{ left: `${word.x*100}%`, top: `${word.y*100}%`, width: `${word.w*100}%`, height: `${word.h*100}%` }}
                  />
                )
              })}
            </div>
          </div>

          {/* Current word banner */}
          <div className="bg-gray-900 border-t border-gray-800 px-4 py-2 flex-shrink-0">
            {currentWord ? (
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-xs">Word {currentIdx + 1}/{total}</span>
                <span className="text-orange-300 font-bold text-lg">{currentWord.text}</span>
                <span className="text-gray-500 text-xs">Page {currentWord.pageNum}</span>
              </div>
            ) : (
              <p className="text-green-400 text-center text-sm font-medium">✓ All words stamped!</p>
            )}
          </div>

          {/* Audio player */}
          <div className="bg-gray-900 border-t border-gray-800 px-4 py-3 flex-shrink-0">
            {!localPath && audioUrl && !showCustomUrl && (
              <div className="mb-2 flex items-center gap-2">
                <p className="text-gray-400 text-xs flex-1">
                  Using remote audio — playback may fail due to CORS.
                </p>
                <button onClick={() => setShowCustomUrl(true)}
                  className="text-xs bg-gray-600 hover:bg-gray-500 text-white px-2 py-1 rounded">
                  ✏ Custom URL
                </button>
                <button onClick={downloadAudio} disabled={downloading}
                  className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded disabled:opacity-50">
                  {downloading ? 'Downloading…' : '⬇ Save locally'}
                </button>
              </div>
            )}
            {showCustomUrl && (
              <div className="mb-2">
                <p className="text-gray-400 text-xs mb-1">
                  Paste a direct audio URL (MP3/AAC/M4A). Open the QR link in browser → DevTools → Network → filter Media to find it.
                </p>
                <div className="flex gap-1">
                  <input
                    type="url"
                    value={customUrlInput}
                    onChange={e => setCustomUrlInput(e.target.value)}
                    placeholder="https://example.com/audio.mp3"
                    className="flex-1 bg-gray-800 border border-gray-600 text-white text-xs rounded px-2 py-1.5 min-w-0"
                  />
                  <button onClick={saveCustomUrl} disabled={savingUrl || !customUrlInput.trim()}
                    className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded disabled:opacity-50 whitespace-nowrap">
                    {savingUrl ? '…' : 'Set'}
                  </button>
                  <button onClick={() => setShowCustomUrl(false)}
                    className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-2 py-1.5 rounded">
                    ✕
                  </button>
                </div>
              </div>
            )}
            {downloadErr && <p className="text-yellow-400 text-xs mb-2">{downloadErr}</p>}

            <audio
              ref={audioRef}
              src={audioSrc}
              controls
              onCanPlay={() => setAudioReady(true)}
              onError={() => setAudioReady(false)}
              className="w-full h-10 mb-2"
              style={{ colorScheme: 'dark' }}
            />

            {/* Speed buttons */}
            <div className="flex items-center gap-1 mb-2">
              <span className="text-gray-500 text-xs mr-1">Speed:</span>
              {[0.5, 0.75, 1, 1.25].map(s => (
                <button key={s} onClick={() => setSpeed(s)}
                  className={`text-xs px-2 py-1 rounded transition-colors ${
                    speed === s ? 'bg-amber-500 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}>{s}x</button>
              ))}
            </div>
          </div>

          {/* Mark / Undo controls */}
          <div className="bg-gray-950 border-t border-gray-800 px-4 py-3 flex gap-2 flex-shrink-0">
            <button onClick={handleUndo} disabled={currentIdx === 0}
              className="flex-none bg-gray-700 hover:bg-gray-600 disabled:opacity-30 text-white px-4 py-3 rounded-xl font-medium text-sm">
              ← Undo
            </button>
            <button onClick={handleMark} disabled={!currentWord || !audioReady}
              className="flex-1 bg-amber-500 hover:bg-amber-600 active:scale-95 disabled:opacity-40 text-white py-3 rounded-xl font-bold text-lg transition-all">
              🎤 Mark
            </button>
            <button onClick={() => currentIdx < allWords.length - 1 && setCurrentIdx(i => i + 1)}
              disabled={currentIdx >= allWords.length - 1}
              className="flex-none bg-gray-700 hover:bg-gray-600 disabled:opacity-30 text-white px-4 py-3 rounded-xl font-medium text-sm">
              Skip →
            </button>
          </div>
        </>
      )}
    </div>
  )
}
