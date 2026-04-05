import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type Ctx = { params: Promise<{ childId: string }> }

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { childId } = await params
  const { name, color } = await req.json() as { name?: string; color?: string }
  const child = await prisma.child.update({ where: { id: childId }, data: { name, color } })
  return NextResponse.json(child)
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { childId } = await params
  await prisma.child.delete({ where: { id: childId } })
  return NextResponse.json({ ok: true })
}
