import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const children = await prisma.child.findMany({ orderBy: { createdAt: 'asc' } })
  return NextResponse.json(children)
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { name, color } = await req.json() as { name: string; color?: string }
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  const child = await prisma.child.create({ data: { name: name.trim(), color: color ?? '#f59e0b' } })
  return NextResponse.json(child)
}
