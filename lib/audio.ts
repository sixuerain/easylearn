import { existsSync } from 'fs'
import path from 'path'

const AUDIO_EXTS = ['mp3', 'aac', 'm4a', 'ogg', 'wav']

/** Returns the served path of a locally cached audio file, or null if not downloaded yet. */
export function getLocalAudioPath(bookId: string): string | null {
  for (const ext of AUDIO_EXTS) {
    const file = path.join(process.cwd(), 'storage', 'audio', `${bookId}.${ext}`)
    if (existsSync(file)) return `/api/audio/${bookId}.${ext}`
  }
  return null
}

/** Infers a file extension from a Content-Type header or URL string. */
export function inferAudioExt(contentType: string, url: string): string {
  if (contentType.includes('mpeg') || contentType.includes('mp3')) return 'mp3'
  if (contentType.includes('aac')) return 'aac'
  if (contentType.includes('mp4') || contentType.includes('m4a')) return 'm4a'
  if (contentType.includes('ogg')) return 'ogg'
  if (contentType.includes('wav')) return 'wav'
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase()
  if (ext && AUDIO_EXTS.includes(ext)) return ext
  return 'mp3'
}
