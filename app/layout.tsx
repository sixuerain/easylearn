import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import NextAuthProvider from '@/components/SessionProvider'

const geist = Geist({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'EasyLearn',
  description: 'Read along with your kids',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className={`${geist.className} min-h-full`}>
        <NextAuthProvider>{children}</NextAuthProvider>
      </body>
    </html>
  )
}
