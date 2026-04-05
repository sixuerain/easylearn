import { NextResponse } from 'next/server'
import { readFile, stat } from 'fs/promises'
import path from 'path'

const EXT_TYPE: Record<string, string> = {
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params
  if (!segments?.length) return new NextResponse('Not found', { status: 404 })

  const filePath = path.join(process.cwd(), 'storage', 'audio', ...segments)
  const uploadsRoot = path.join(process.cwd(), 'storage', 'audio')
  if (!filePath.startsWith(uploadsRoot)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  try {
    const info = await stat(filePath)
    const ext = filePath.split('.').pop()?.toLowerCase() ?? 'mp3'
    const contentType = EXT_TYPE[ext] ?? 'audio/mpeg'
    const rangeHeader = req.headers.get('range')

    if (rangeHeader) {
      // Support range requests so the browser can seek
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
      const start = match ? parseInt(match[1]) : 0
      const end = match && match[2] ? parseInt(match[2]) : info.size - 1
      const chunkSize = end - start + 1

      const { createReadStream } = await import('fs')
      const stream = createReadStream(filePath, { start, end })
      const webStream = new ReadableStream({
        start(controller) {
          stream.on('data', chunk => {
            try { controller.enqueue(chunk) } catch { /* client disconnected */ }
          })
          stream.on('end', () => {
            try { controller.close() } catch { /* already closed */ }
          })
          stream.on('error', err => {
            try { controller.error(err) } catch { /* already closed */ }
          })
        },
        cancel() {
          stream.destroy()
        },
      })
      return new NextResponse(webStream, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Range': `bytes ${start}-${end}/${info.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      })
    }

    const data = await readFile(filePath)
    return new NextResponse(data, {
      headers: {
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(info.size),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return new NextResponse('Not found', { status: 404 })
  }
}
