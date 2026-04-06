import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import SettingsForm from './SettingsForm'

export default async function SettingsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  return <SettingsForm />
}
