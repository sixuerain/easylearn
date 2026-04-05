import type { Metadata, Viewport } from 'next'
import './globals.css'
import NextAuthProvider from '@/components/SessionProvider'
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar'

export const metadata: Metadata = {
  title: 'EasyLearn',
  description: 'Read along with your kids',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'EasyLearn',
  },
}

export const viewport: Viewport = {
  themeColor: '#f59e0b',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="font-sans min-h-full">
        <NextAuthProvider>{children}</NextAuthProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  )
}
