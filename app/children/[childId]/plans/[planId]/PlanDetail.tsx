'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface Timing { startMs: number; endMs: number }
interface PlanWord {
  wordId: string; text: string; imagePath: string; pageNum: number
  x: number; y: number; w: number; h: number
  timing: Timing | null; audioUrl: string | null
}
interface SessionResult { wordId: string; text: string; correct: boolean }
interface Session {
  id: string; score: number; total: number; completedAt: string
  results: SessionResult[]
}

type Mode = 'overview' | 'exercise' | 'result'

export default function PlanDetail({ childId, planId, planName, childName, childColor, words, sessions: initialSessions }: {
  childId: string; planId: string; planName: string; childName: string; childColor: string
  words: PlanWord[]; sessions: Session[]
}) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('overview')
  const [sessions, setSessions] = useState(initialSessions)

  // Exercise state
  const [exIdx, setExIdx] = useState(0)
  const [answers, setAnswers] = useState<Record<string, boolean>>({})
  const [playingId, setPlayingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  function startExercise() {
    setExIdx(0)
    setAnswers({})
    setMode('exercise')
  }

  function playWord(word: PlanWord) {
    if (!word.timing || !word.audioUrl || !audioRef.current) return
    const audio = audioRef.current
    audio.src = word.audioUrl
    audio.currentTime = word.timing.startMs / 1000
    setPlayingId(word.wordId)
    audio.play()
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      audio.pause()
      setPlayingId(null)
    }, word.timing.endMs - word.timing.startMs + 200)
  }

  function answer(correct: boolean) {
    const word = words[exIdx]
    const next = { ...answers, [word.wordId]: correct }
    setAnswers(next)
    if (exIdx < words.length - 1) {
      setExIdx(i => i + 1)
    } else {
      saveAndFinish(next)
    }
  }

  async function saveAndFinish(finalAnswers: Record<string, boolean>) {
    const results = words.map(w => ({ wordId: w.wordId, correct: finalAnswers[w.wordId] ?? false }))
    const res = await fetch(`/api/children/${childId}/plans/${planId}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results }),
    })
    const session: Session & { results: SessionResult[] } = await res.json()
    // Attach word texts
    const withText = {
      ...session,
      results: session.results.map((r: { wordId: string; correct: boolean }) => ({
        ...r,
        text: words.find(w => w.wordId === r.wordId)?.text ?? '',
      })),
    }
    setSessions(prev => [withText, ...prev])
    setMode('result')
  }

  async function deletePlan() {
    if (!confirm('Delete this exercise plan?')) return
    await fetch(`/api/children/${childId}/plans/${planId}`, { method: 'DELETE' })
    router.push(`/children/${childId}`)
  }

  const currentWord = words[exIdx]
  const latestSession = sessions[0]

  // ── Overview ────────────────────────────────────────────────────────────────
  if (mode === 'overview') {
    return (
      <main className="min-h-screen bg-amber-50 p-4">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-3 mb-6 pt-2">
            <Link href={`/children/${childId}`} className="text-amber-600 text-2xl leading-none">←</Link>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-gray-800">{planName}</h1>
              <p className="text-xs text-gray-400">{childName} · {words.length} words</p>
            </div>
            <button onClick={deletePlan} className="text-gray-300 hover:text-red-400 text-xl px-2">🗑</button>
          </div>

          {/* Word list */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-5">
            <h2 className="font-semibold text-gray-600 text-sm mb-3">Words in this plan</h2>
            <div className="flex flex-wrap gap-2">
              {words.map(w => (
                <span key={w.wordId} className="px-3 py-1 bg-amber-50 border border-amber-200 rounded-full text-amber-800 text-sm font-medium">
                  {w.text}
                </span>
              ))}
            </div>
          </div>

          {/* Start button */}
          <button onClick={startExercise}
            className="w-full bg-amber-500 hover:bg-amber-600 text-white py-4 rounded-2xl font-bold text-xl mb-5 transition-colors active:scale-95">
            ▶ Start Exercise
          </button>

          {/* History */}
          {sessions.length > 0 && (
            <div>
              <h2 className="font-semibold text-gray-700 mb-3">History</h2>
              <div className="space-y-2">
                {sessions.map(s => {
                  const pct = s.total > 0 ? Math.round(s.score / s.total * 100) : 0
                  const date = new Date(s.completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                  return (
                    <div key={s.id} className="bg-white rounded-xl border border-gray-100 p-3 flex items-center gap-3">
                      <div className={`text-2xl font-bold w-14 text-center ${pct >= 80 ? 'text-green-500' : pct >= 50 ? 'text-amber-500' : 'text-red-400'}`}>
                        {pct}%
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-gray-600">{s.score}/{s.total} correct</p>
                        <p className="text-xs text-gray-400">{date}</p>
                      </div>
                      <div className="flex flex-wrap gap-1 max-w-[140px] justify-end">
                        {s.results.slice(0, 6).map(r => (
                          <span key={r.wordId} className={`text-xs px-1.5 py-0.5 rounded ${r.correct ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                            {r.text}
                          </span>
                        ))}
                        {s.results.length > 6 && <span className="text-xs text-gray-400">+{s.results.length - 6}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </main>
    )
  }

  // ── Exercise ─────────────────────────────────────────────────────────────────
  if (mode === 'exercise') {
    const progress = exIdx / words.length * 100
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col">
        <audio ref={audioRef} onEnded={() => setPlayingId(null)} />

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-gray-900 border-b border-gray-800">
          <button onClick={() => setMode('overview')} className="text-gray-400 text-xl">✕</button>
          <div className="flex-1">
            <p className="text-white font-medium text-sm">{planName}</p>
            <p className="text-gray-400 text-xs">Word {exIdx + 1} of {words.length}</p>
          </div>
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
            style={{ backgroundColor: childColor }}>
            {childName[0]}
          </div>
        </div>

        {/* Progress */}
        <div className="h-1.5 bg-gray-800">
          <div className="h-full bg-amber-500 transition-all" style={{ width: `${progress}%` }} />
        </div>

        {/* Card */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
          {/* Page image with word highlight */}
          <div className="relative w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl bg-gray-800">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={currentWord.imagePath} alt="" className="w-full block" />
            <div className="absolute border-2 border-orange-400 bg-yellow-300/40 rounded"
              style={{
                left: `${currentWord.x * 100}%`, top: `${currentWord.y * 100}%`,
                width: `${currentWord.w * 100}%`, height: `${currentWord.h * 100}%`,
              }} />
          </div>

          {/* Word text */}
          <div className="text-center">
            <p className="text-white text-4xl font-bold tracking-wide">{currentWord.text}</p>
            {currentWord.timing && currentWord.audioUrl ? (
              <button onClick={() => playWord(currentWord)}
                className={`mt-3 px-6 py-2 rounded-full text-sm font-medium transition-colors ${
                  playingId === currentWord.wordId
                    ? 'bg-amber-500 text-white'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}>
                {playingId === currentWord.wordId ? '⏸ Playing…' : '▶ Listen'}
              </button>
            ) : (
              <p className="text-gray-600 text-sm mt-2">No audio</p>
            )}
          </div>
        </div>

        {/* Answer buttons */}
        <div className="p-4 pb-8 grid grid-cols-2 gap-3">
          <button onClick={() => answer(false)}
            className="bg-red-500/20 hover:bg-red-500/30 border-2 border-red-500/50 text-red-400 py-5 rounded-2xl font-bold text-xl active:scale-95 transition-all">
            ✗ Not yet
          </button>
          <button onClick={() => answer(true)}
            className="bg-green-500/20 hover:bg-green-500/30 border-2 border-green-500/50 text-green-400 py-5 rounded-2xl font-bold text-xl active:scale-95 transition-all">
            ✓ Got it!
          </button>
        </div>
      </div>
    )
  }

  // ── Result ───────────────────────────────────────────────────────────────────
  const score = latestSession?.score ?? 0
  const total = latestSession?.total ?? words.length
  const pct = total > 0 ? Math.round(score / total * 100) : 0

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        {/* Score */}
        <div className="text-center mb-8">
          <div className={`text-8xl font-black mb-2 ${pct >= 80 ? 'text-green-400' : pct >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
            {pct}%
          </div>
          <p className="text-white text-2xl font-bold">{score}/{total} correct</p>
          <p className="text-gray-400 mt-1">
            {pct >= 80 ? '🌟 Excellent work!' : pct >= 50 ? '👍 Good effort!' : '💪 Keep practising!'}
          </p>
        </div>

        {/* Per-word results */}
        <div className="bg-gray-900 rounded-2xl p-4 mb-6">
          <div className="flex flex-wrap gap-2">
            {(latestSession?.results ?? []).map(r => (
              <span key={r.wordId}
                className={`px-3 py-1.5 rounded-full text-sm font-medium ${r.correct ? 'bg-green-900/60 text-green-300' : 'bg-red-900/60 text-red-300'}`}>
                {r.correct ? '✓' : '✗'} {r.text}
              </span>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={startExercise}
            className="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-3 rounded-2xl font-bold transition-colors">
            Try Again
          </button>
          <button onClick={() => setMode('overview')}
            className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-2xl font-medium transition-colors">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
