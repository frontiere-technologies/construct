import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pino', 'pino-pretty'],
  // In sviluppo gli indirizzi dei tenant si provano con i sottodomini di localhost
  // (multi-tenancy, pezzo 4, MT4-DEC-14): Next serve loro le risorse di sviluppo.
  allowedDevOrigins: ['a.localhost', 'b.localhost'],
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
