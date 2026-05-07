import { Assets, Texture } from 'pixi.js'

import {
  BACKGROUND_IMAGES,
  SHOT_SPRITES,
  ZOMBIE_SPRITES,
  type ImageEntry,
  type SpriteSheetEntry,
} from '../config/manifest'

export type ProgressCallback = (progress: number) => void

export class AssetLoader {
  private readonly textures = new Map<string, Texture>()

  async loadAll(onProgress?: ProgressCallback): Promise<void> {
    const all: Array<SpriteSheetEntry | ImageEntry> = [
      ...ZOMBIE_SPRITES,
      ...SHOT_SPRITES,
      ...BACKGROUND_IMAGES,
    ]

    for (let i = 0; i < all.length; i++) {
      const entry = all[i]!
      const texture = await Assets.load<Texture>(entry.src)
      this.textures.set(entry.alias, texture)
      onProgress?.((i + 1) / all.length)
    }
  }

  get(alias: string): Texture {
    const t = this.textures.get(alias)
    if (!t) throw new Error(`AssetLoader: missing texture "${alias}"`)
    return t
  }

  has(alias: string): boolean {
    return this.textures.has(alias)
  }
}
