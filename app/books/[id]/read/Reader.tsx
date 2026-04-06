'use client'

import { useState, useRef, useMemo, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface Timing { startMs: number; endMs: number }
interface Word { id: string; text: string; x: number; y: number; w: number; h: number; timing: Timing | null }
interface PageData { id: string; pageNum: number; imagePath: string; words: Word[] }
interface OcrWordRef { id: string; x: number; y: number; w: number; h: number; pageId: string }
interface TranscriptWordData {
  id: string
  text: string
  startMs: number
  endMs: number
  pageId: string | null
  ocrWord: OcrWordRef | null
}

interface Props {
  bookId: string
  title: string
  audioSrc: string | null
  pages: PageData[]
  childId: string | null
  initialPageIdx: number
  initialBookmarks: string[]
  transcriptWords: TranscriptWordData[]
}

function fmt(s: number) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

/**
 * Web Audio API wrapper for sample-accurate seeking.
 * Decodes the entire file into an AudioBuffer so seeks are exact.
 */
function useWebAudio(src: string | null) {
  const ctxRef = useRef<AudioContext | null>(null)
  const bufferRef = useRef<AudioBuffer | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [currentMs, setCurrentMs] = useState(0)
  const [ready, setReady] = useState(false)

  const startTimeRef = useRef(0)
  const startOffsetRef = useRef(0)
  const rateRef = useRef(1)
  const rafRef = useRef<number>(0)
  const playingRef = useRef(false)

  const tick = useCallback(() => {
    if (!playingRef.current || !ctxRef.current) return
    const elapsed = (ctxRef.current.currentTime - startTimeRef.current) * rateRef.current
    setCurrentMs((startOffsetRef.current + elapsed) * 1000)
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  useEffect(() => {
    if (!src) return
    let cancelled = false
    async function load() {
      const ctx = new AudioContext()
      ctxRef.current = ctx
      const gain = ctx.createGain()
      gain.connect(ctx.destination)
      gainRef.current = gain
      const resp = await fetch(src!)
      const arrayBuf = await resp.arrayBuffer()
      const decoded = await ctx.decodeAudioData(arrayBuf)
      if (cancelled) { ctx.close().catch(() => {}); return }
      bufferRef.current = decoded
      setDuration(decoded.duration)
      setReady(true)
    }
    load()
    return () => {
      cancelled = true
      cancelAnimationFrame(rafRef.current)
      try { sourceRef.current?.stop() } catch {}
      ctxRef.current?.close().catch(() => {})
    }
  }, [src])

  const play = useCallback((fromOffset?: number) => {
    const ctx = ctxRef.current
    const buf = bufferRef.current
    const gain = gainRef.current
    if (!ctx || !buf || !gain) return
    if (sourceRef.current) { sourceRef.current.onended = null; sourceRef.current.stop() }

    const offset = fromOffset ?? startOffsetRef.current
    const source = ctx.createBufferSource()
    source.buffer = buf
    source.playbackRate.value = rateRef.current
    source.connect(gain)
    source.onended = () => {
      if (playingRef.current) { playingRef.current = false; setPlaying(false); cancelAnimationFrame(rafRef.current) }
    }
    sourceRef.current = source
    startOffsetRef.current = offset
    startTimeRef.current = ctx.currentTime
    if (ctx.state === 'suspended') ctx.resume()
    source.start(0, offset)
    playingRef.current = true
    setPlaying(true)
    rafRef.current = requestAnimationFrame(tick)
  }, [tick])

  const pause = useCallback(() => {
    if (!playingRef.current || !ctxRef.current) return
    const elapsed = (ctxRef.current.currentTime - startTimeRef.current) * rateRef.current
    startOffsetRef.current += elapsed
    if (sourceRef.current) { sourceRef.current.onended = null; sourceRef.current.stop() }
    playingRef.current = false
    setPlaying(false)
    cancelAnimationFrame(rafRef.current)
  }, [])

  const togglePlay = useCallback(() => { playing ? pause() : play() }, [playing, play, pause])

  const seekTo = useCallback((secs: number) => {
    const clamped = Math.max(0, Math.min(secs, bufferRef.current?.duration ?? 0))
    startOffsetRef.current = clamped
    setCurrentMs(clamped * 1000)
    if (playingRef.current) play(clamped)
  }, [play])

  const seekBy = useCallback((delta: number) => {
    let cur = startOffsetRef.current
    if (playingRef.current && ctxRef.current) {
      cur += (ctxRef.current.currentTime - startTimeRef.current) * rateRef.current
    }
    seekTo(cur + delta)
  }, [seekTo])

  const setSpeed = useCallback((rate: number) => {
    rateRef.current = rate
    if (playingRef.current && ctxRef.current) {
      const elapsed = (ctxRef.current.currentTime - startTimeRef.current) * (sourceRef.current?.playbackRate.value ?? 1)
      play(startOffsetRef.current + elapsed)
    }
  }, [play])

  return { duration, playing, currentMs, ready, togglePlay, play, pause, seekTo, seekBy, setSpeed }
}

export default function Reader({ bookId, title, audioSrc, pages, childId, initialPageIdx, initialBookmarks, transcriptWords }: Props) {
  const allWords = useMemo(
    () => pages.flatMap(p => p.words.map(w => ({ ...w, pageId: p.id, pageNum: p.pageNum }))),
    [pages]
  )
  const useTranscript = transcriptWords.length > 0
  const hasTimings = useTranscript || allWords.some(w => w.timing)

  const audio = useWebAudio(audioSrc)
  const [speed, setSpeed] = useState(1)
  const [pageIdx, setPageIdx] = useState(initialPageIdx)
  const [showControls, setShowControls] = useState(true)
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set(initialBookmarks))
  const [bookmarkAnim, setBookmarkAnim] = useState<string | null>(null)
  const controlTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const progressSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const currentPage = pages[pageIdx]

  // Active transcript word (primary timeline when available)
  const activeTranscript = useMemo(() => {
    if (!useTranscript) return null
    return transcriptWords.find(tw => audio.currentMs >= tw.startMs && audio.currentMs < tw.endMs) ?? null
  }, [audio.currentMs, transcriptWords, useTranscript])

  // Fallback: active OCR word via legacy WordTiming
  const activeLegacyWord = useMemo(() => {
    if (useTranscript || !hasTimings) return null
    return allWords.find(w => w.timing && audio.currentMs >= w.timing.startMs && audio.currentMs < w.timing.endMs) ?? null
  }, [audio.currentMs, allWords, hasTimings, useTranscript])

  // The active highlight OCR word ID (from transcript match or legacy)
  const activeOcrWordId = useTranscript
    ? activeTranscript?.ocrWord?.id ?? null
    : activeLegacyWord?.id ?? null

  // The active display text (for the bottom banner)
  const activeText = useTranscript
    ? activeTranscript?.text ?? null
    : activeLegacyWord?.text ?? null

  // Auto-advance page when active word is on a different page
  const activePageId = useTranscript
    ? (activeTranscript?.ocrWord?.pageId ?? activeTranscript?.pageId ?? null)
    : (activeLegacyWord ? pages.find(p => p.words.some(w => w.id === activeLegacyWord.id))?.id ?? null : null)

  useEffect(() => {
    if (!activePageId) return
    const idx = pages.findIndex(p => p.id === activePageId)
    if (idx !== -1 && idx !== pageIdx) setPageIdx(idx)
  }, [activePageId])

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

  useEffect(() => { audio.setSpeed(speed) }, [speed])

  function seekToWord(word: typeof allWords[0]) {
    if (useTranscript) {
      // Find transcript word linked to this OCR word
      const tw = transcriptWords.find(t => t.ocrWord?.id === word.id)
      if (tw) {
        audio.seekTo(tw.startMs / 1000)
        if (!audio.playing) audio.play(tw.startMs / 1000)
        return
      }
    }
    // Legacy fallback
    if (!word.timing) return
    audio.seekTo(word.timing.startMs / 1000)
    if (!audio.playing) audio.play(word.timing.startMs / 1000)
  }

  function seekToProgress(e: React.MouseEvent<HTMLDivElement>) {
    if (!audio.duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    audio.seekTo(((e.clientX - rect.left) / rect.width) * audio.duration)
  }

  // Bookmark: use OCR word ID from active transcript or legacy word
  const bookmarkWordId = activeOcrWordId
  async function toggleBookmark() {
    if (!childId || !bookmarkWordId) return
    const isBookmarked = bookmarks.has(bookmarkWordId)
    setBookmarks(prev => {
      const n = new Set(prev)
      isBookmarked ? n.delete(bookmarkWordId) : n.add(bookmarkWordId)
      return n
    })
    setBookmarkAnim(bookmarkWordId)
    setTimeout(() => setBookmarkAnim(null), 600)
    if (isBookmarked) {
      await fetch(`/api/children/${childId}/bookmarks/${bookmarkWordId}`, { method: 'DELETE' })
    } else {
      await fetch(`/api/children/${childId}/bookmarks/${bookmarkWordId}`, { method: 'POST' })
    }
  }

  function resetControlTimer() {
    setShowControls(true)
    clearTimeout(controlTimer.current)
    if (audio.playing) controlTimer.current = setTimeout(() => setShowControls(false), 4000)
  }
  useEffect(() => { if (audio.playing) resetControlTimer(); else setShowControls(true) }, [audio.playing])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return
      if (e.code === 'Space') { e.preventDefault(); audio.togglePlay() }
      if (e.code === 'ArrowRight') audio.seekBy(5)
      if (e.code === 'ArrowLeft') audio.seekBy(-5)
      if (e.code === 'PageDown') setPageIdx(i => Math.min(pages.length - 1, i + 1))
      if (e.code === 'PageUp') setPageIdx(i => Math.max(0, i - 1))
      if (e.code === 'KeyB') toggleBookmark()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [audio.togglePlay, pages.length, bookmarkWordId, childId, bookmarks])

  const progress = audio.duration ? (audio.currentMs / (audio.duration * 1000)) * 100 : 0

  // Word class for OCR bounding box overlays
  function wordClass(word: Word) {
    const hasLink = useTranscript
      ? transcriptWords.some(tw => tw.ocrWord?.id === word.id)
      : !!word.timing
    if (!hasLink) return 'border-transparent bg-transparent pointer-events-none'

    if (activeOcrWordId === word.id)
      return 'border-orange-400 bg-yellow-300/50 shadow-[0_0_0_3px_rgba(251,191,36,0.4)] cursor-pointer z-10'

    // Check if word has been passed
    if (useTranscript) {
      const tw = transcriptWords.find(t => t.ocrWord?.id === word.id)
      if (tw && audio.currentMs >= tw.endMs)
        return 'border-green-400/30 bg-green-200/15 cursor-pointer'
    } else if (word.timing && audio.currentMs >= word.timing.endMs) {
      return 'border-green-400/30 bg-green-200/15 cursor-pointer'
    }

    return 'border-sky-300/20 bg-transparent cursor-pointer'
  }

  const isActiveBookmarked = bookmarkWordId ? bookmarks.has(bookmarkWordId) : false

  return (
    <div className="min-h-screen bg-black flex flex-col select-none" onClick={resetControlTimer}>
      {/* Header */}
      <div className={`flex items-center px-4 py-2 bg-gradient-to-b from-black/80 to-transparent absolute top-0 left-0 right-0 z-20 transition-opacity duration-500 ${showControls || !audio.playing ? 'opacity-100' : 'opacity-0'}`}>
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
          <img src={currentPage?.imagePath} alt={`Page ${currentPage?.pageNum}`}
            className="w-full block rounded-xl shadow-2xl" />
          {currentPage?.words.map(word => (
            <div key={word.id}
              onClick={() => seekToWord({ ...word, pageId: currentPage.id, pageNum: currentPage.pageNum })}
              className={`absolute border-2 rounded transition-colors ${wordClass(word)}`}
              style={{
                left: `${word.x * 100}%`, top: `${word.y * 100}%`,
                width: `${word.w * 100}%`, height: `${word.h * 100}%`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Active word display + bookmark */}
      <div className="absolute bottom-[10.5rem] left-0 right-0 flex justify-center px-4 pointer-events-none">
        {activeText && (
          <div className="flex items-center gap-2 bg-black/70 backdrop-blur px-4 py-2 rounded-full pointer-events-auto">
            <span className="text-yellow-300 text-2xl font-bold tracking-wide">{activeText}</span>
            {childId && bookmarkWordId && (
              <button onClick={toggleBookmark}
                className={`text-2xl transition-transform ${bookmarkAnim === bookmarkWordId ? 'scale-150' : 'scale-100'}`}>
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
      <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black/90 to-transparent pt-8 pb-safe transition-opacity duration-500 ${showControls || !audio.playing ? 'opacity-100' : 'opacity-0'}`}>
        <div className="px-4 mb-3">
          <div className="relative h-1.5 bg-gray-700 rounded-full cursor-pointer" onClick={seekToProgress}>
            <div className="absolute left-0 top-0 h-full bg-amber-500 rounded-full transition-[width]"
              style={{ width: `${progress}%` }} />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-gray-500 text-xs">{fmt(audio.currentMs / 1000)}</span>
            <span className="text-gray-500 text-xs">{fmt(audio.duration)}</span>
          </div>
        </div>

        <div className="flex items-center justify-between px-6 pb-6">
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

          <div className="flex items-center gap-4">
            <button onClick={() => audio.seekBy(-10)} className="text-gray-300 text-2xl">⟪</button>
            <button onClick={audio.togglePlay}
              className="w-16 h-16 bg-amber-500 hover:bg-amber-400 active:scale-95 rounded-full flex items-center justify-center text-white text-3xl shadow-lg transition-all">
              {audio.playing ? '⏸' : '▶'}
            </button>
            <button onClick={() => audio.seekBy(10)} className="text-gray-300 text-2xl">⟫</button>
          </div>

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
    </div>
  )
}
