import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getApiKey, setApiKey, getSelectedProvider, setSelectedProvider } from '@/lib/settings'
import { ensureProviders } from '@/lib/providers/init'
import { allProviders } from '@/lib/providers/registry'

const API_KEY_SLUGS = ['openai', 'anthropic', 'google', 'deepseek', 'moonshot']

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  ensureProviders()

  const [ocrProvider, audioProvider] = await Promise.all([
    getSelectedProvider('ocr'),
    getSelectedProvider('audio'),
  ])

  const keyStatus: Record<string, boolean> = {}
  for (const slug of API_KEY_SLUGS) {
    keyStatus[slug] = !!(await getApiKey(slug))
  }

  const providers = allProviders().map(p => ({
    name: p.name,
    slug: p.slug,
    capabilities: p.capabilities,
  }))

  return NextResponse.json({ ocrProvider, audioProvider, keyStatus, providers })
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  if (body.ocrProvider) {
    await setSelectedProvider('ocr', body.ocrProvider)
  }
  if (body.audioProvider) {
    await setSelectedProvider('audio', body.audioProvider)
  }
  if (body.apiKeys && typeof body.apiKeys === 'object') {
    for (const [slug, key] of Object.entries(body.apiKeys)) {
      if (API_KEY_SLUGS.includes(slug) && typeof key === 'string') {
        await setApiKey(slug, key)
      }
    }
  }

  return NextResponse.json({ ok: true })
}
