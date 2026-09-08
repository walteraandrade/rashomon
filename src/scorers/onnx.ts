import type { Scorer } from '../types.js'

type Dtype = 'fp32' | 'fp16' | 'q8' | 'int8' | 'uint8' | 'q4' | 'bnb4' | 'q4f16'
type Contract = { max_length: number; labels: string[] }
type Encoded = { input_ids: number[]; token_type_ids: number[] }
type Loaded = { ids: (s: string) => number[]; run: (e: Encoded) => Promise<number[]>; cls: number; sep: number; contract: Contract }

const modelId = () => process.env.TESTIMONY_MODEL ?? ''
const cacheDir = () => process.env.MODEL_DIR ?? './data/models'
const dtype = () => process.env.TESTIMONY_DTYPE ?? 'q8'

// A Hub ref: commit sha, tag or branch. The charset is narrower than query.ts's METHOD_TOKEN
// and excludes `:` and `/` on purpose, so `kikori:<dtype>:<revision>` stays a three-part label
// the method parser accepts whole. Anything outside it reads as unset rather than throwing:
// query.ts resolves the route's default method through here on every request and must not 500
// on a typo. src/score.ts is where a missing revision stops a run instead.
const REVISION_TOKEN = /^[\w.-]{1,64}$/
export const modelRevision = () => {
  const v = process.env.TESTIMONY_REVISION ?? ''
  return REVISION_TOKEN.test(v) ? v : ''
}

// Row label for doc_testimony: the placeholder scorer wrote `onnx`; kikori rows carry the
// dtype so a q8 run and an fp32 run never mix with each other nor with the old rows, and the
// model revision so a retrain republished under the same name does neither (issue #67).
// Without it, `pnpm score` would leave every existing row alone and score only the pairs added
// since, with the new model, under the first model's label. The revision is also what `load`
// asks the Hub for, so the label is a claim the loader enforces, not a note an operator wrote.
// With TESTIMONY_REVISION unset the label stays `kikori:<dtype>`, which is what every row
// scored before this existed carries.
export const kikoriMethod = () => {
  const rev = modelRevision()
  return rev ? `kikori:${dtype()}:${rev}` : `kikori:${dtype()}`
}

// [CLS] person [SEP] text [SEP], token_type_ids 0 for the person segment and 1 for the text.
// Only the text is cut, so the closing [SEP] always survives; transformers.js's own
// `truncation: true` drops that [SEP] on long inputs and moves the score.
export const pairIds = (person: number[], text: number[], maxLength: number, cls: number, sep: number): Encoded => {
  const cut = text.slice(0, Math.max(0, maxLength - person.length - 3))
  return {
    input_ids: [cls, ...person, sep, ...cut, sep],
    token_type_ids: [...Array<number>(person.length + 2).fill(0), ...Array<number>(cut.length + 1).fill(1)],
  }
}

export const scoreFromLogits = (logits: number[], labels: string[]) => {
  const m = Math.max(...logits)
  const e = logits.map((x) => Math.exp(x - m))
  const z = e.reduce((a, b) => a + b, 0)
  return ((e[labels.indexOf('pos')] - e[labels.indexOf('neg')]) / z) * 10
}

const loaded = new Map<string, Promise<Loaded>>()

// The @huggingface/transformers import and any from_pretrained call must stay inside this
// function body, never hoisted to module scope: merely importing this file (transitively,
// via src/scorers/index.ts from src/score.ts) must never touch the network, which is what
// keeps `pnpm typecheck`/`pnpm test` safe without ever setting TESTIMONY_SCORER=onnx.
const load = async (): Promise<Loaded> => {
  const { AutoTokenizer, AutoModelForSequenceClassification, Tensor } = await import('@huggingface/transformers')
  // `revision` is omitted, not spelled 'main', when unset: transformers.js has its own default
  // and naming it here would make an unpinned run indistinguishable from a pinned one.
  const rev = modelRevision()
  const opts = rev ? { cache_dir: cacheDir(), revision: rev } : { cache_dir: cacheDir() }
  const tok = await AutoTokenizer.from_pretrained(modelId(), opts)
  const model = await AutoModelForSequenceClassification.from_pretrained(modelId(), { ...opts, dtype: dtype() as Dtype })
  const contract = (model.config as unknown as { kikori?: Contract }).kikori
  if (!contract) throw new Error(`${modelId()}: config.json has no "kikori" contract`)
  const ids = (s: string, add_special_tokens = false) =>
    Array.from((tok(s, { add_special_tokens }).input_ids as { data: ArrayLike<number | bigint> }).data, Number)
  const framed = ids('x', true)
  const mk = (arr: number[]) => new Tensor('int64', BigInt64Array.from(arr, BigInt), [1, arr.length])
  const run = async (e: Encoded) => {
    const out = (await model({
      input_ids: mk(e.input_ids),
      attention_mask: mk(e.input_ids.map(() => 1)),
      token_type_ids: mk(e.token_type_ids),
    })) as { logits: { data: ArrayLike<number> } }
    return Array.from(out.logits.data, Number)
  }
  return { ids: (s) => ids(s), run, cls: framed[0], sep: framed[framed.length - 1], contract }
}

const model = () => {
  const key = `${modelId()}|${dtype()}|${modelRevision()}|${cacheDir()}`
  const hit = loaded.get(key) ?? load()
  loaded.set(key, hit)
  return hit
}

export const onnx: Scorer = async (text, person) => {
  if (!text.trim()) return null
  const m = await model()
  const encoded = pairIds(m.ids(person.name), m.ids(text), m.contract.max_length, m.cls, m.sep)
  return scoreFromLogits(await m.run(encoded), m.contract.labels)
}
