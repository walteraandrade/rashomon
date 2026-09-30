// A `[key, bareKey | null]` pair names a different bare fallback or none (null).
export type SeedKey = string | [string, string | null]

export type Seed = Record<string, string | undefined>

// A prefixed value (`atlas.days=`) overrides the bare one (`days=`) for that figure only.
export const seedFor = (figureId: string, keys: SeedKey[], search: string): Seed => {
  const params = new URLSearchParams(search)
  return Object.fromEntries(
    keys.map((entry) => {
      const [key, bareKey] = Array.isArray(entry) ? entry : [entry, entry]
      const prefixed = params.get(`${figureId}.${key}`)
      const bare = bareKey ? params.get(bareKey) : null
      return [key, prefixed ?? bare ?? undefined]
    }),
  )
}
