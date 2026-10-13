import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { PrefixClass, PrefixOverrides } from '../../shared/utils/hebrew'

const FILE = 'prefix.overrides.json'
const PREFIX_CLASSES: readonly PrefixClass[] = ['prefix', 'root', 'formative']

export const prefixOverridesEditable = import.meta.dev

export function isPrefixClass(value: unknown): value is PrefixClass {
  return PREFIX_CLASSES.includes(value as PrefixClass)
}

// In dev, read/write the source file directly so edits apply immediately; in a
// build it's a read-only bundled server asset.
const devPath = () => resolve(process.cwd(), 'server/assets', FILE)

export async function loadPrefixOverrides(): Promise<PrefixOverrides> {
  if (import.meta.dev) {
    try {
      return JSON.parse(await readFile(devPath(), 'utf8'))
    } catch {
      return {}
    }
  }
  return (await useStorage('assets:server').getItem<PrefixOverrides>(FILE).catch(() => null)) ?? {}
}

/** Set (or with null, clear) the override for a word; returns the updated overrides. */
export async function savePrefixOverride(word: string, classification: PrefixClass | null): Promise<PrefixOverrides> {
  const overrides = await loadPrefixOverrides()
  if (classification) overrides[word] = classification
  else delete overrides[word]
  const sorted = Object.fromEntries(Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b)))
  await writeFile(devPath(), `${JSON.stringify(sorted, null, 2)}\n`)
  return sorted
}

/** Short stable fingerprint of the overrides, for cache keys. */
export function overridesFingerprint(overrides: PrefixOverrides): string {
  let h = 5381
  for (const [k, v] of Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b))) {
    for (const ch of `${k}=${v};`) h = ((h << 5) + h + ch.charCodeAt(0)) | 0
  }
  return (h >>> 0).toString(36)
}
