import { readFileSync } from 'fs'
import path from 'path'
import type { LLMProvider, AudioToTextResult } from './types'

const gemini: LLMProvider = {
  name: 'Google Gemini',
  slug: 'google',
  capabilities: ['image-to-text', 'audio-to-text'],

  async imageToText(imagePath, language, apiKey) {
    const imageBuffer = readFileSync(imagePath)
    const base64 = imageBuffer.toString('base64')
    const ext = imagePath.split('.').pop()?.toLowerCase() ?? 'jpeg'
    const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg'

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType, data: base64 } },
              { text: `Extract ALL text from this image exactly as written, preserving reading order. The text is in ${language}. Output ONLY the extracted text.` },
            ],
          }],
        }),
      }
    )

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Gemini API error (${res.status}): ${err}`)
    }

    const data = await res.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
    return { text }
  },

  async audioToText(audioPath, language, apiKey): Promise<AudioToTextResult> {
    const audioBuffer = readFileSync(audioPath)
    const base64 = audioBuffer.toString('base64')
    const ext = path.extname(audioPath).slice(1) || 'mp3'
    const mimeMap: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac', ogg: 'audio/ogg' }
    const mimeType = mimeMap[ext] ?? 'audio/mpeg'

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType, data: base64 } },
              { text: `Transcribe this audio in ${language}. Return the full transcript with timestamps in this JSON format: [{"text":"sentence","startMs":0,"endMs":1000},...]. Output ONLY valid JSON.` },
            ],
          }],
        }),
      }
    )

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Gemini API error (${res.status}): ${err}`)
    }

    const data = await res.json()
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''

    try {
      const jsonStr = raw.replace(/^```json\s*/, '').replace(/\s*```$/, '')
      const chunks = JSON.parse(jsonStr) as { text: string; startMs: number; endMs: number }[]
      const fullText = chunks.map(c => c.text).join(' ')
      return { text: fullText, chunks }
    } catch {
      return { text: raw }
    }
  },
}

export default gemini
