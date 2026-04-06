import { readFileSync } from 'fs'
import type { ImageToTextResult } from './types'

/**
 * Shared helper for OpenAI-compatible vision APIs (OpenAI, DeepSeek, Kimi).
 */
export async function callVisionApi(
  baseUrl: string,
  model: string,
  apiKey: string,
  imagePath: string,
  language: string,
): Promise<ImageToTextResult> {
  const imageBuffer = readFileSync(imagePath)
  const base64 = imageBuffer.toString('base64')
  const ext = imagePath.split('.').pop()?.toLowerCase() ?? 'jpeg'
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg'

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: `You are an OCR assistant. Extract ALL text from the image exactly as written, preserving reading order. The text is in ${language}. Output ONLY the extracted text, nothing else.`,
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
            { type: 'text', text: 'Extract all text from this image.' },
          ],
        },
      ],
      max_tokens: 4096,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`${baseUrl} API error (${res.status}): ${err}`)
  }

  const data = await res.json()
  const text = data.choices?.[0]?.message?.content?.trim() ?? ''
  return { text }
}
