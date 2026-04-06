import { createWorker } from 'tesseract.js'
import sharp from 'sharp'
import path from 'path'
import { getSelectedProvider, getApiKey } from './settings'
import { ensureProviders } from './providers/init'
import { getProvider } from './providers/registry'

export interface OcrWord {
  text: string
  x: number   // normalized 0–1
  y: number
  w: number
  h: number
  orderIdx: number
}

const LANG_MAP: Record<string, string> = {
  en: 'eng',
  zh: 'chi_sim',
  ja: 'jpn',
  ko: 'kor',
  es: 'spa',
  fr: 'fra',
}

const LANG_NAME: Record<string, string> = {
  en: 'English', zh: 'Chinese', ja: 'Japanese',
  ko: 'Korean', es: 'Spanish', fr: 'French',
}

function resolveStoragePath(imagePath: string): string {
  const suffix = imagePath.replace(/^\/api\/img\/books\//, '')
  return path.join(process.cwd(), 'storage', 'books', suffix)
}

/**
 * Run OCR using the currently selected provider.
 * Falls back to local tesseract if the LLM provider is not configured.
 */
export async function runOcr(imagePath: string, language = 'en'): Promise<OcrWord[]> {
  const providerSlug = await getSelectedProvider('ocr')

  if (providerSlug === 'tesseract') {
    return runTesseractOcr(imagePath, language)
  }

  ensureProviders()
  const provider = getProvider(providerSlug)
  const apiKey = await getApiKey(providerSlug)

  if (!provider?.imageToText || !apiKey) {
    console.log(`[ocr] Provider "${providerSlug}" not available, falling back to tesseract`)
    return runTesseractOcr(imagePath, language)
  }

  try {
    const fullPath = resolveStoragePath(imagePath)
    const langName = LANG_NAME[language] ?? language
    console.log(`[ocr] Using ${provider.name} for image-to-text`)
    const result = await provider.imageToText(fullPath, langName, apiKey)

    if (result.words && result.words.length > 0) {
      return result.words
    }

    // LLM returned plain text — split into words with placeholder bounding boxes
    return textToOcrWords(result.text, language)
  } catch (err) {
    console.error(`[ocr] ${providerSlug} failed, falling back to tesseract:`, err)
    return runTesseractOcr(imagePath, language)
  }
}

/**
 * Local tesseract.js OCR with bounding box extraction.
 */
async function runTesseractOcr(imagePath: string, language: string): Promise<OcrWord[]> {
  const fullPath = resolveStoragePath(imagePath)
  const { width = 1, height = 1 } = await sharp(fullPath).metadata()

  const lang = LANG_MAP[language] ?? 'eng'
  const worker = await createWorker(lang, 1, {
    cachePath: path.join(process.cwd(), '.tesseract'),
  })

  try {
    const { data } = await worker.recognize(fullPath, {}, { blocks: true })
    const words: OcrWord[] = []
    let idx = 0

    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        for (const line of para.lines ?? []) {
          for (const word of line.words ?? []) {
            const text = word.text.trim()
            if (!text || word.confidence < 20) continue
            const { x0, y0, x1, y1 } = word.bbox
            words.push({
              text,
              x: x0 / width,
              y: y0 / height,
              w: (x1 - x0) / width,
              h: (y1 - y0) / height,
              orderIdx: idx++,
            })
          }
        }
      }
    }

    return words
  } finally {
    await worker.terminate()
  }
}

/**
 * Convert plain text from LLM into OcrWord array.
 * CJK: split into individual characters.
 * Alphabetic: split on whitespace/punctuation.
 * Bounding boxes are placeholder (0,0,0,0) since LLMs don't provide them.
 */
function textToOcrWords(text: string, language: string): OcrWord[] {
  const isCjk = ['zh', 'ja', 'ko'].includes(language)
  const words: OcrWord[] = []
  let idx = 0

  if (isCjk) {
    for (const char of text) {
      const trimmed = char.trim()
      if (!trimmed) continue
      words.push({ text: trimmed, x: 0, y: 0, w: 0, h: 0, orderIdx: idx++ })
    }
  } else {
    for (const token of text.split(/\s+/)) {
      const trimmed = token.trim()
      if (!trimmed) continue
      words.push({ text: trimmed, x: 0, y: 0, w: 0, h: 0, orderIdx: idx++ })
    }
  }

  return words
}
