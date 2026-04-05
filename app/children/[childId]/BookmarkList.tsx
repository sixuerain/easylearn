'use client'

import { useState, useRef } from 'react'

interface Timing { startMs: number; endMs: number }
interface Bookmark {
  id: string; wordId: string; text: string
  imagePath: string; bookId: string; pageNum: number
  x: number; y: number; w: number; h: number
  timing: Timing | null
  audioUrl: string | null
}

export default function BookmarkList({ childId, bookmarks: initial }: { childId: string; bookmarks: Bookmark[] }) {
  const [bookmarks, setBookmarks] = useState(initial)
  const [playing, setPlaying] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  function playWord(bm: Bookmark) {
    if (!bm.timing || !bm.audioUrl || !audioRef.current) return
    const audio = audioRef.current
    audio.src = bm.audioUrl
    audio.currentTime = bm.timing.startMs / 1000
    setPlaying(bm.wordId)
    audio.play()
    clearTimeout(timerRef.current)
    const dur = bm.timing.endMs - bm.timing.startMs
    timerRef.current = setTimeout(() => {
      audio.pause()
      setPlaying(null)
    }, dur + 200)
  }

  async function removeBookmark(wordId: string) {
    await fetch(`/api/children/${childId}/bookmarks/${wordId}`, { method: 'DELETE' })
    setBookmarks(prev => prev.filter(b => b.wordId !== wordId))
  }

  return (
    <div>
      <audio ref={audioRef} onEnded={() => setPlaying(null)} />
      <div className="grid grid-cols-2 gap-3">
        {bookmarks.map(bm => (
          <div key={bm.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
            {/* Page thumbnail with word highlight */}
            <div className="relative aspect-[4/3] bg-gray-100 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={bm.imagePath} alt="" className="w-full h-full object-cover object-top" />
              <div className="absolute inset-0 bg-black/10" />
              {/* Word highlight box */}
              <div className="absolute border-2 border-orange-400 bg-yellow-300/40 rounded"
                style={{
                  left: `${bm.x * 100}%`, top: `${bm.y * 100}%`,
                  width: `${bm.w * 100}%`, height: `${bm.h * 100}%`,
                }} />
            </div>
            {/* Word + controls */}
            <div className="p-3">
              <p className="font-bold text-gray-800 text-lg text-center mb-2">{bm.text}</p>
              <div className="flex items-center gap-2">
                {bm.timing && bm.audioUrl ? (
                  <button onClick={() => playWord(bm)}
                    className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      playing === bm.wordId
                        ? 'bg-amber-500 text-white'
                        : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                    }`}>
                    {playing === bm.wordId ? '⏸' : '▶'} Listen
                  </button>
                ) : (
                  <div className="flex-1 py-1.5 rounded-lg text-xs text-gray-400 text-center bg-gray-50">No audio</div>
                )}
                <button onClick={() => removeBookmark(bm.wordId)}
                  className="text-gray-300 hover:text-red-400 px-1 transition-colors">✕</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
