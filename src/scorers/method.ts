export type Dtype = 'fp32' | 'fp16' | 'q8' | 'int8' | 'uint8' | 'q4' | 'bnb4' | 'q4f16'

export const dtype = () => process.env.TESTIMONY_DTYPE ?? 'q8'

// Charset excludes `:` and `/` so `kikori:<dtype>:<revision>` stays a three-part label.
const REVISION_TOKEN = /^[\w.-]{1,64}$/
export const modelRevision = () => {
  const v = process.env.TESTIMONY_REVISION ?? ''
  return REVISION_TOKEN.test(v) ? v : ''
}

// dtype/revision prevent different runs from mixing; unset revision matches all pre-revision rows.
export const kikoriMethod = () => {
  const rev = modelRevision()
  return rev ? `kikori:${dtype()}:${rev}` : `kikori:${dtype()}`
}

export const methods: Record<'stub' | 'onnx', () => string> = { stub: () => 'stub', onnx: kikoriMethod }
