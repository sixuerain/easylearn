import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['sharp', 'better-sqlite3', 'tesseract.js'],
  images: {
    unoptimized: true,
  },
}

export default nextConfig
