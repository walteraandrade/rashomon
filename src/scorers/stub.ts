import type { Scorer } from '../types.js'

// Deterministic and hermetic on purpose: same (text, person) always yields the same
// score, across runs and processes, so tests never need a real model. FNV-1a keeps
// this a pure function of its inputs, not tied to insertion order or any global state.
const fnv1a = (s: string) => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export const stub: Scorer = async (text, person) => {
  if (!text.trim()) return null
  const h = fnv1a(`${person.id}:${text}`)
  return Math.round(((h % 2001) / 100 - 10) * 100) / 100
}
