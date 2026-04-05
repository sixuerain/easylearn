import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['sharp', 'better-sqlite3', 'tesseract.js', 'playwright-core', 'music-metadata', '@xenova/transformers', 'node-web-audio-api'],
  images: {
    unoptimized: true,
  },
}

export default nextConfig
