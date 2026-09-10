import type { Scorer } from '../types.js'
import { methods } from './method.js'
import { onnx } from './onnx.js'
import { stub } from './stub.js'

export const scorers: Record<'stub' | 'onnx', Scorer> = { stub, onnx }

export { methods }
