'use client'

import { useState, useRef, useMemo, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface Timing { startMs: number; endMs: number }
interface Word { id: string; text: string; x: number; y: number; w: number; h: number; timing: Timing | null }
interface PageData { id: string; pageNum: number; imagePath: string; words: Word[] }

interface Props {
  bookId: string
  title: string
  audioSrc: string | null
  pages: PageData[]
  childId: string | null
  initialPageIdx: number
  initialBookmarks: string[]  // word IDs already bookmarked
}

function fmt(s: number) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function Reader({ bookId, title, audioSrc, pages, childId, initialPageIdx, initialBookmarks }: Props) {
  const allWords = useMemo(
    () => pages.flatMap(p => p.words.map(w => ({ ...w, pageId: p.id, pageNum: p.pageNum }))),
    [pages]
  )
  const hasTimings = allWords.some(w => w.timing)

  const audioRef = useRef<HTMLAudioElement>(null)
  const [currentMs, setCurrentMs] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [pageIdx, setPageIdx] = useState(initialPageIdx)
  const [showControls, setShowControls] = useState(true)
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set(initialBookmarks))
  const [bookmarkAnim, setBookmarkAnim] = useState<string | null>(null) // word id being animated
  const controlTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const progressSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const currentPage = pages[pageIdx]

  // Active word based on current playback position
  const activeWord = useMemo(() => {
    if (!hasTimings) return null
    return allWords.find(w => w.timing && currentMs >= w.timing.startMs && currentMs < w.timing.endMs) ?? null
  }, [currentMs, allWords, hasTimings])

  // Auto-advance page when active word moves to a different page
  useEffect(() => {
    if (!activeWord) return
    const idx = pages.findIndex(p => p.id === activeWord.pageId)
    if (idx !== -1 && idx !== pageIdx) setPageIdx(idx)
  }, [activeWord?.pageId])

  // Save reading progress when page changes
  useEffect(() => {
    if (!childId) return
    clearTimeout(progressSaveTimer.current)
    progressSaveTimer.current = setTimeout(() => {
      fetch(`/api/children/${childId}/progress/${bookId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageIdx }),
      })
    }, 800)
  }, [pageIdx, childId, bookId])

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed
  }, [speed])

  const togglePlay = useCallback(() => {
    const a = audioRef.current
    if (!a) return
    a.paused ? a.play() : a.pause()
  }, [])

  function seekToWord(word: typeof allWords[0]) {
    if (!word.timing || !audioRef.current) return
    audioRef.current.currentTime = word.timing.startMs / 1000
    audioRef.current.play()
  }

  function seekBy(secs: number) {
    if (audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime + secs)
  }

  function seekToProgress(e: React.MouseEvent<HTMLDivElement>) {
    if (!audioRef.current || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    audioRef.current.currentTime = ((e.clientX - rect.left) / rect.width) * duration
  }

  // Bookmark active word
  async function toggleBookmark() {
    if (!childId || !activeWord) return
    const wordId = activeWord.id
    const isBookmarked = bookmarks.has(wordId)
    setBookmarks(prev => {
      const n = new Set(prev)
      isBookmarked ? n.delete(wordId) : n.add(wordId)
      return n
    })
    setBookmarkAnim(wordId)
    setTimeout(() => setBookmarkAnim(null), 600)
    if (isBookmarked) {
      await fetch(`/api/children/${childId}/bookmarks/${wordId}`, { method: 'DELETE' })
    } else {
      await fetch(`/api/children/${childId}/bookmarks/${wordId}`, { method: 'POST' })
    }
  }

  // Auto-hide controls after 4s of play
  function resetControlTimer() {
    setShowControls(true)
    clearTimeout(controlTimer.current)
    if (playing) controlTimer.current = setTimeout(() => setShowControls(false), 4000)
  }
  useEffect(() => { if (playing) resetControlTimer(); else setShowControls(true) }, [playing])

  // Keyboard: space = play/pause, ← / → = ±5s, PageUp/Down = prev/next page, b = bookmark
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return
      if (e.code === 'Space') { e.preventDefault(); togglePlay() }
      if (e.code === 'ArrowRight') seekBy(5)
      if (e.code === 'ArrowLeft') seekBy(-5)
      if (e.code === 'PageDown') setPageIdx(i => Math.min(pages.length - 1, i + 1))
      if (e.code === 'PageUp') setPageIdx(i => Math.max(0, i - 1))
      if (e.code === 'KeyB') toggleBookmark()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, pages.length, activeWord, childId, bookmarks])

  const progress = duration ? (currentMs / (duration * 1000)) * 100 : 0

  function wordClass(word: Word) {
    if (!word.timing) return 'border-transparent bg-transparent pointer-events-none'
    const { startMs, endMs } = word.timing
    if (activeWord?.id === word.id)
      return 'border-orange-400 bg-yellow-300/50 shadow-[0_0_0_3px_rgba(251,191,36,0.4)] cursor-pointer z-10'
    if (currentMs >= endMs)
      return 'border-green-400/30 bg-green-200/15 cursor-pointer'
    return 'border-sky-300/20 bg-transparent cursor-pointer'
  }

  const isActiveBookmarked = activeWord ? bookmarks.has(activeWord.id) : false

  return (
    <div
      className="min-h-screen bg-black flex flex-col select-none"
      onClick={resetControlTimer}
    >
      {/* Header */}
      <div className={`flex items-center px-4 py-2 bg-gradient-to-b from-black/80 to-transparent absolute top-0 left-0 right-0 z-20 transition-opacity duration-500 ${showControls || !playing ? 'opacity-100' : 'opacity-0'}`}>
        <Link href={childId ? `/?child=${childId}` : '/'} className="text-gray-300 text-xl mr-3">←</Link>
        <span className="text-gray-200 text-sm font-medium flex-1 truncate">{title}</span>
        <div className="flex items-center gap-1">
          <button onClick={() => setPageIdx(i => Math.max(0, i - 1))} disabled={pageIdx === 0}
            className="text-gray-400 px-2 py-1 text-lg disabled:opacity-30">‹</button>
          <span className="text-gray-400 text-xs">{pageIdx + 1}/{pages.length}</span>
          <button onClick={() => setPageIdx(i => Math.min(pages.length - 1, i + 1))} disabled={pageIdx === pages.length - 1}
            className="text-gray-400 px-2 py-1 text-lg disabled:opacity-30">›</button>
        </div>
      </div>

      {/* Main image area */}
      <div className="flex-1 flex items-center justify-center p-2 pt-12 pb-[11rem] overflow-hidden">
        <div className="relative w-full max-w-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentPage?.imagePath}
            alt={`Page ${currentPage?.pageNum}`}
            className="w-full block rounded-xl shadow-2xl"
          />
          {currentPage?.words.map(word => (
            <div
              key={word.id}
              onClick={() => seekToWord({ ...word, pageId: currentPage.id, pageNum: currentPage.pageNum })}
              className={`absolute border-2 rounded transition-colors ${wordClass(word)}`}
              style={{
                left: `${word.x * 100}%`,
                top: `${word.y * 100}%`,
                width: `${word.w * 100}%`,
                height: `${word.h * 100}%`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Active word display + bookmark */}
      <div className="absolute bottom-[10.5rem] left-0 right-0 flex justify-center px-4 pointer-events-none">
        {activeWord && (
          <div className="flex items-center gap-2 bg-black/70 backdrop-blur px-4 py-2 rounded-full pointer-events-auto">
            <span className="text-yellow-300 text-2xl font-bold tracking-wide">{activeWord.text}</span>
            {childId && (
              <button
                onClick={toggleBookmark}
                className={`text-2xl transition-transform ${bookmarkAnim === activeWord.id ? 'scale-150' : 'scale-100'}`}>
                {isActiveBookmarked ? '⭐' : '☆'}
              </button>
            )}
          </div>
        )}
        {!hasTimings && (
          <div className="bg-black/60 backdrop-blur px-4 py-2 rounded-full">
            <span className="text-gray-400 text-sm">No word timings — go to 🎵 Sync first</span>
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black/90 to-transparent pt-8 pb-safe transition-opacity duration-500 ${showControls || !playing ? 'opacity-100' : 'opacity-0'}`}>
        {/* Progress bar */}
        <div className="px-4 mb-3">
          <div className="relative h-1.5 bg-gray-700 rounded-full cursor-pointer" onClick={seekToProgress}>
            <div className="absolute left-0 top-0 h-full bg-amber-500 rounded-full transition-[width]"
              style={{ width: `${progress}%` }} />
            {hasTimings && allWords.filter(w => w.timing).map(w => (
              <div key={w.id}
                className={`absolute top-1/2 -translate-y-1/2 w-1 h-1 rounded-full ${
                  w.id === activeWord?.id ? 'bg-orange-400 w-2 h-2' :
                  currentMs >= (w.timing!.endMs) ? 'bg-green-500' : 'bg-gray-500'
                }`}
                style={{ left: `${duration ? (w.timing!.startMs / (duration * 1000)) * 100 : 0}%` }}
              />
            ))}
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-gray-500 text-xs">{fmt(currentMs / 1000)}</span>
            <span className="text-gray-500 text-xs">{fmt(duration)}</span>
          </div>
        </div>

        {/* Playback controls */}
        <div className="flex items-center justify-between px-6 pb-6">
          {/* Speed */}
          <div className="flex gap-1">
            {[0.75, 1, 1.25, 1.5].map(s => (
              <button key={s} onClick={() => setSpeed(s)}
                className={`text-xs px-2 py-1 rounded-lg transition-colors ${
                  speed === s ? 'bg-amber-500 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}>
                {s}x
              </button>
            ))}
          </div>

          {/* Main controls */}
          <div className="flex items-center gap-4">
            <button onClick={() => seekBy(-10)} className="text-gray-300 text-2xl">⟪</button>
            <button onClick={togglePlay}
              className="w-16 h-16 bg-amber-500 hover:bg-amber-400 active:scale-95 rounded-full flex items-center justify-center text-white text-3xl shadow-lg transition-all">
              {playing ? '⏸' : '▶'}
            </button>
            <button onClick={() => seekBy(10)} className="text-gray-300 text-2xl">⟫</button>
          </div>

          {/* Child dashboard or Sync link */}
          {childId ? (
            <Link href={`/children/${childId}`}
              className="text-gray-500 hover:text-gray-300 text-xs text-center leading-tight">
              👧<br />Me
            </Link>
          ) : (
            <Link href={`/books/${bookId}/sync`}
              className="text-gray-500 hover:text-gray-300 text-xs text-center leading-tight">
              🎵<br />Sync
            </Link>
          )}
        </div>
      </div>

      {audioSrc && (
        <audio ref={audioRef} src={audioSrc}
          onTimeUpdate={() => setCurrentMs((audioRef.current?.currentTime ?? 0) * 1000)}
          onDurationChange={() => setDuration(audioRef.current?.duration ?? 0)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      )}
    </div>
  )
}
