import type { ZombieType } from '@hips/shared'

// Mirror of apps/client/src/config/manifest.ts: ZOMBIE_BODY_BOX.
// Kept in the server module for now to avoid pulling client-only files
// into the shared package (which would force a Pixi-free split).
export const ZOMBIE_BODY_BOX: Record<ZombieType, { width: number; height: number }> = {
  man: { width: 40, height: 65 },
  woman: { width: 40, height: 65 },
  wild: { width: 75, height: 35 },
}
