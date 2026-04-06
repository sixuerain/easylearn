import { prisma } from './prisma'
import crypto from 'crypto'

function getEncryptionKey(): Buffer {
  const secret = process.env.SETTINGS_SECRET ?? process.env.NEXTAUTH_SECRET ?? 'easylearn-default-key'
  return crypto.createHash('sha256').update(secret).digest()
}

function encrypt(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

function decrypt(encoded: string): string {
  const key = getEncryptionKey()
  const [ivHex, tagHex, encHex] = encoded.split(':')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return decipher.update(Buffer.from(encHex, 'hex')) + decipher.final('utf8')
}

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } })
  return row?.value ?? null
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  })
}

export async function getApiKey(providerSlug: string): Promise<string | null> {
  const enc = await getSetting(`apikey.${providerSlug}`)
  if (!enc) return null
  try { return decrypt(enc) } catch { return null }
}

export async function setApiKey(providerSlug: string, plainKey: string): Promise<void> {
  if (!plainKey.trim()) {
    await prisma.setting.deleteMany({ where: { key: `apikey.${providerSlug}` } })
    return
  }
  await setSetting(`apikey.${providerSlug}`, encrypt(plainKey.trim()))
}

export async function getSelectedProvider(capability: 'ocr' | 'audio'): Promise<string> {
  return (await getSetting(`provider.${capability}`)) ?? (capability === 'ocr' ? 'tesseract' : 'whisper-local')
}

export async function setSelectedProvider(capability: 'ocr' | 'audio', slug: string): Promise<void> {
  await setSetting(`provider.${capability}`, slug)
}
