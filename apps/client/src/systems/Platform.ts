// Treat any device with a touch-capable input as mobile. `maxTouchPoints > 0`
// covers modern iPads (whose user-agent now masquerades as desktop Safari),
// while the `ontouchstart` fallback handles older browsers. Hybrid laptops
// also get the on-screen controls — that's intentional, they don't conflict
// with keyboard/mouse since both input paths feed the same InputManager.
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false
  if ('ontouchstart' in window) return true
  return navigator.maxTouchPoints > 0
}
