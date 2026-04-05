import { createWorker } from 'tesseract.js'
import sharp from 'sharp'
import path from 'path'

export interface OcrWord {
  text: string
  x: number   // normalized 0–1 (left edge / image width)
  y: number   // normalized 0–1 (top edge / image height)
  w: number   // normalized 0–1 (box width / image width)
  h: number   // normalized 0–1 (box height / image height)
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

export async function runOcr(imagePath: string, language = 'en'): Promise<OcrWord[]> {
  const fullPath = path.join(process.cwd(), 'public', imagePath)
  const { width = 1, height = 1 } = await sharp(fullPath).metadata()

  const lang = LANG_MAP[language] ?? 'eng'
  const worker = await createWorker(lang, 1, {
    cachePath: path.join(process.cwd(), '.tesseract'),
  })

  try {
    const { data } = await worker.recognize(fullPath)
    const words: OcrWord[] = []
    let idx = 0

    // tesseract.js v5: words are nested in blocks → paragraphs → lines → words
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
