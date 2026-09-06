import type { Scorer } from '../types.js'

const modelId = () => process.env.TESTIMONY_MODEL ?? ''
const cacheDir = () => process.env.MODEL_DIR ?? './data/models'

// The @huggingface/transformers import and any pipeline()/model-loading call must stay
// inside this function body, never hoisted to module scope: merely importing this file
// (transitively, via src/scorers/index.ts from src/score.ts) must never touch the network,
// which is what keeps `pnpm typecheck`/`pnpm test` safe without ever setting TESTIMONY_SCORER=onnx.
export const onnx: Scorer = async (text, person) => {
  if (!text.trim()) return null
  const { pipeline } = await import('@huggingface/transformers')
  const classify = await pipeline('text-classification', modelId(), { cache_dir: cacheDir() })
  const [result] = await classify(text)
  const label = (result as { label?: string; score?: number }) ?? {}
  const magnitude = typeof label.score === 'number' ? label.score : 0
  const sign = label.label === 'NEGATIVE' ? -1 : 1
  void person
  return Math.round(sign * magnitude * 10 * 100) / 100
}
