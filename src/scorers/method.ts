// Zero imports, on purpose: nothing this file exports can ever pull in the model loader
// (src/scorers/onnx.ts), so anything reaching only this far never traces into the Hub
// client it dynamic-imports. src/query.ts resolves the route's default method through here.
export type Dtype = 'fp32' | 'fp16' | 'q8' | 'int8' | 'uint8' | 'q4' | 'bnb4' | 'q4f16'

export const dtype = () => process.env.TESTIMONY_DTYPE ?? 'q8'

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

// The doc_testimony.method label each scorer writes under; `onnx` is a scorer name, not a row label.
export const methods: Record<'stub' | 'onnx', () => string> = { stub: () => 'stub', onnx: kikoriMethod }
