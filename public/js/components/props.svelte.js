// The figure's inputs, as reactive state app.js can assign to. Only what the fetches resolve
// lives here — the outlet in focus stays inside TestimonyFigure.svelte, where no querystring
// builder can reach it.

/** @typedef {import('../format.js').OutletRow} OutletRow */
/** @typedef {import('../format.js').Testimony} Testimony */

/** @type {{ testimony: Testimony | null, outletRows: OutletRow[] | null, status: 'loading' | 'ready' | 'error', person: string, width: number }} */
export const props = $state({ testimony: null, outletRows: null, status: 'loading', person: '', width: 860 })
