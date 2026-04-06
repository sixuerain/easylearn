import type { OcrWord } from '@/lib/ocr'

export type Capability = 'image-to-text' | 'audio-to-text'

export interface ImageToTextResult {
  text: string
  words?: OcrWord[]
}

export interface AudioChunk {
  text: string
  startMs: number
  endMs: number
}

export interface AudioToTextResult {
  text: string
  chunks?: AudioChunk[]
}

export interface LLMProvider {
  name: string
  slug: string
  capabilities: Capability[]
  imageToText?(imagePath: string, language: string, apiKey: string): Promise<ImageToTextResult>
  audioToText?(audioPath: string, language: string, apiKey: string): Promise<AudioToTextResult>
}
