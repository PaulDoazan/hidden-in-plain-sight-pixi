const DEFAULT_ORIGIN = 'http://localhost:5173'

export function getCorsOrigin(): string | string[] {
  const raw = process.env.CORS_ORIGIN ?? DEFAULT_ORIGIN
  const [first, ...rest] = raw.split(',').map((s) => s.trim()).filter(Boolean)
  if (!first) return DEFAULT_ORIGIN
  return rest.length === 0 ? first : [first, ...rest]
}
