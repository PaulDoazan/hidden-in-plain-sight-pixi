import { Container } from 'pixi.js'

import type { AssetLoader } from '../systems/AssetLoader'
import { findNearestZombieWithin, type Point } from '../systems/CollisionDetector'

import { BloodSplat } from './BloodSplat'
import type { Zombie } from './Zombie'

export interface FireParams {
  origin: Point
  radius: number
  zombies: Zombie[]
  layer: Container
  assets: AssetLoader
}

export function fire({ origin, radius, zombies, layer, assets }: FireParams): Zombie | null {
  const target = findNearestZombieWithin(origin, zombies, radius)
  if (!target) return null

  const splat = new BloodSplat(assets)
  splat.position.set(origin.x, origin.y)
  layer.addChild(splat)

  target.die()
  return target
}
