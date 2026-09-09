import { mount } from 'svelte'
import { props } from './props.svelte.js'
import TestimonyFigure from './TestimonyFigure.svelte'

export { props } from './props.svelte.js'

/** @param {Element} target */
export const mountTestimonyFigure = (target) => mount(TestimonyFigure, { target, props })
