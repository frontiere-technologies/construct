export function shouldUseSecureCookies(externalUrl: string | undefined, nodeEnv: string | undefined): boolean {
  if (externalUrl) {
    try {
      return new URL(externalUrl).protocol === 'https:'
    } catch {
      return nodeEnv === 'production'
    }
  }
  return nodeEnv === 'production'
}
