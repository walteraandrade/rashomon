// Declares the compiled Svelte island for tsc, which cannot read .svelte sources. The real
// type check on those files is `pnpm check` (svelte-check).
import type { OutletRow, Testimony } from '../format.js'

export declare const props: {
  testimony: Testimony | null
  outletRows: OutletRow[] | null
  status: 'loading' | 'ready' | 'error'
  person: string
  width: number
}
export declare const mountTestimonyFigure: (target: Element) => void
