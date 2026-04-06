import { readFileSync } from 'fs'
import type { LLMProvider } from './types'

const claude: LLMProvider = {
  name: 'Claude',
  slug: 'anthropic',
  capabilities: ['image-to-text'],

  async imageToText(imagePath, language, apiKey) {
    const imageBuffer = readFileSync(imagePath)
    const base64 = imageBuffer.toString('base64')
    const ext = imagePath.split('.').pop()?.toLowerCase() ?? 'jpeg'
    const mediaType = ext === 'png' ? 'image/png' : 'image/jpeg'

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: `You are an OCR assistant. Extract ALL text from the image exactly as written, preserving reading order. The text is in ${language}. Output ONLY the extracted text, nothing else.`,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
              { type: 'text', text: 'Extract all text from this image.' },
            ],
          },
        ],
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Anthropic API error (${res.status}): ${err}`)
    }

    const data = await res.json()
    const text = data.content?.[0]?.text?.trim() ?? ''
    return { text }
  },
}

export default claude
