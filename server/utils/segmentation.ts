import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ModelVotes } from '../../shared/types/siddur'

const FILE = 'segmentation.json'

/** lexiconKey → LM votes/segmentation, precomputed by scripts/build-segmentation.py. */
export type SegmentationTable = Record<string, ModelVotes>

let cache: SegmentationTable | null = null

export async function loadSegmentation(): Promise<SegmentationTable> {
  if (cache) return cache
  let table: SegmentationTable = {}
  if (import.meta.dev) {
    try {
      table = JSON.parse(await readFile(resolve(process.cwd(), 'server/assets', FILE), 'utf8'))
    } catch { /* asset optional */ }
  } else {
    table = (await useStorage('assets:server').getItem<SegmentationTable>(FILE).catch(() => null)) ?? {}
  }
  cache = table
  return table
}
