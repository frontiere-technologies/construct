import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['pino', 'pino-pretty'],
  devIndicators: {
    position: 'bottom-right',
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
}

export default nextConfig
