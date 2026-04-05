import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['sharp', 'better-sqlite3', 'tesseract.js', 'playwright-core'],
  images: {
    unoptimized: true,
  },
}

export default nextConfig
