import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'

const EXT_TYPE: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', webp: 'image/webp', gif: 'image/gif',
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params
  // Only allow paths under uploads/
  if (!segments || segments[0] !== 'books') {
    return new NextResponse('Not found', { status: 404 })
  }

  const filePath = path.join(process.cwd(), 'storage', 'books', ...segments.slice(1))
  // Prevent path traversal
  const uploadsRoot = path.join(process.cwd(), 'storage', 'books')
  if (!filePath.startsWith(uploadsRoot)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  try {
    const data = await readFile(filePath)
    const ext = filePath.split('.').pop()?.toLowerCase() ?? 'jpg'
    const contentType = EXT_TYPE[ext] ?? 'application/octet-stream'
    return new NextResponse(data, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return new NextResponse('Not found', { status: 404 })
  }
}
