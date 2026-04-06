import { readFileSync } from 'fs'
import path from 'path'
import type { LLMProvider, AudioToTextResult } from './types'
import { callVisionApi } from './openai-compat'

const openai: LLMProvider = {
  name: 'OpenAI',
  slug: 'openai',
  capabilities: ['image-to-text', 'audio-to-text'],

  async imageToText(imagePath, language, apiKey) {
    return callVisionApi('https://api.openai.com/v1', 'gpt-4o', apiKey, imagePath, language)
  },

  async audioToText(audioPath, language, apiKey): Promise<AudioToTextResult> {
    const buf = readFileSync(audioPath)
    const ext = path.extname(audioPath).slice(1) || 'mp3'
    const blob = new Blob([buf], { type: `audio/${ext}` })

    const form = new FormData()
    form.append('file', blob, `audio.${ext}`)
    form.append('model', 'whisper-1')
    form.append('language', language === 'zh' ? 'zh' : language)
    form.append('response_format', 'verbose_json')
    form.append('timestamp_granularities[]', 'segment')

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: form,
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`OpenAI Whisper API error (${res.status}): ${err}`)
    }

    const data = await res.json()
    const chunks = (data.segments ?? []).map((s: { text: string; start: number; end: number }) => ({
      text: s.text,
      startMs: Math.round(s.start * 1000),
      endMs: Math.round(s.end * 1000),
    }))

    return { text: data.text ?? '', chunks }
  },
}

export default openai
