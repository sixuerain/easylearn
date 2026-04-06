'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface ProviderInfo {
  name: string
  slug: string
  capabilities: string[]
}

interface SettingsData {
  ocrProvider: string
  audioProvider: string
  keyStatus: Record<string, boolean>
  providers: ProviderInfo[]
}

const KEY_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  google: 'Google (Gemini)',
  deepseek: 'DeepSeek',
  moonshot: 'Kimi (Moonshot)',
}

export default function SettingsForm() {
  const [data, setData] = useState<SettingsData | null>(null)
  const [ocrProvider, setOcrProvider] = useState('tesseract')
  const [audioProvider, setAudioProvider] = useState('whisper-local')
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then((d: SettingsData) => {
        setData(d)
        setOcrProvider(d.ocrProvider)
        setAudioProvider(d.audioProvider)
      })
  }, [])

  async function save() {
    setSaving(true); setMsg('')
    try {
      const apiKeys: Record<string, string> = {}
      for (const [slug, val] of Object.entries(keys)) {
        if (val.trim()) apiKeys[slug] = val.trim()
      }
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ocrProvider, audioProvider, apiKeys }),
      })
      if (res.ok) {
        setMsg('Saved')
        setKeys({})
        const d = await (await fetch('/api/settings')).json()
        setData(d)
      } else {
        setMsg('Failed to save')
      }
    } finally { setSaving(false) }
  }

  if (!data) return <div className="min-h-screen bg-[#faf8f5] flex items-center justify-center text-stone-400">Loading...</div>

  const ocrOptions = [
    { slug: 'tesseract', name: 'Tesseract (local)' },
    ...data.providers.filter(p => p.capabilities.includes('image-to-text')),
  ]
  const audioOptions = [
    { slug: 'whisper-local', name: 'Whisper (local)' },
    ...data.providers.filter(p => p.capabilities.includes('audio-to-text')),
  ]

  return (
    <main className="min-h-screen bg-[#faf8f5] p-4 pb-12">
      <div className="max-w-lg mx-auto">
        <header className="flex items-center gap-2 mb-6 pt-1">
          <Link href="/" className="text-stone-400 hover:text-stone-600 transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
          <h1 className="text-xl font-bold text-stone-800 font-hand">Settings</h1>
        </header>

        {/* Provider Selection */}
        <section className="bg-white rounded-xl border border-stone-200 p-4 mb-4">
          <h2 className="text-sm font-semibold text-stone-700 mb-3">Providers</h2>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-stone-500 mb-1 block">Image to Text (OCR)</label>
              <select
                value={ocrProvider}
                onChange={e => setOcrProvider(e.target.value)}
                className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm text-stone-800"
              >
                {ocrOptions.map(o => (
                  <option key={o.slug} value={o.slug}>{o.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-stone-500 mb-1 block">Audio to Text</label>
              <select
                value={audioProvider}
                onChange={e => setAudioProvider(e.target.value)}
                className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm text-stone-800"
              >
                {audioOptions.map(o => (
                  <option key={o.slug} value={o.slug}>{o.name}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* API Keys */}
        <section className="bg-white rounded-xl border border-stone-200 p-4 mb-4">
          <h2 className="text-sm font-semibold text-stone-700 mb-3">API Keys</h2>
          <p className="text-xs text-stone-400 mb-3">Keys are encrypted at rest. Enter a new value to update, or leave blank to keep existing.</p>

          <div className="space-y-3">
            {Object.entries(KEY_LABELS).map(([slug, label]) => (
              <div key={slug}>
                <label className="text-xs text-stone-500 mb-1 flex items-center gap-2">
                  {label}
                  {data.keyStatus[slug] && (
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" title="Key configured" />
                  )}
                </label>
                <input
                  type="password"
                  value={keys[slug] ?? ''}
                  onChange={e => setKeys(prev => ({ ...prev, [slug]: e.target.value }))}
                  placeholder={data.keyStatus[slug] ? '••••••••  (configured)' : 'Not set'}
                  className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm text-stone-800 placeholder:text-stone-300"
                />
              </div>
            ))}
          </div>
        </section>

        {/* Available Providers Reference */}
        <section className="bg-white rounded-xl border border-stone-200 p-4 mb-6">
          <h2 className="text-sm font-semibold text-stone-700 mb-3">Available Providers</h2>
          <div className="space-y-2">
            {data.providers.map(p => (
              <div key={p.slug} className="flex items-center justify-between text-xs">
                <span className="text-stone-700">{p.name}</span>
                <div className="flex gap-1">
                  {p.capabilities.includes('image-to-text') && (
                    <span className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">OCR</span>
                  )}
                  {p.capabilities.includes('audio-to-text') && (
                    <span className="bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded">Audio</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Save */}
        <button
          onClick={save}
          disabled={saving}
          className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-medium py-2.5 rounded-xl transition-colors"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
        {msg && (
          <p className={`text-center text-xs mt-2 ${msg === 'Saved' ? 'text-green-600' : 'text-red-500'}`}>
            {msg}
          </p>
        )}
      </div>
    </main>
  )
}
