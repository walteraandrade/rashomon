import type { Scorer } from '../types.js'
import { kikoriMethod, onnx } from './onnx.js'
import { stub } from './stub.js'

export const scorers: Record<'stub' | 'onnx', Scorer> = { stub, onnx }

// The doc_testimony.method label each scorer writes under; `onnx` is a scorer name, not a row label.
export const methods: Record<keyof typeof scorers, () => string> = { stub: () => 'stub', onnx: kikoriMethod }
