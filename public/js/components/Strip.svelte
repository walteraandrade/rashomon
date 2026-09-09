<script>
  import { fmt, signed, sourceLabels, testimonyColor, testimonyPosition, foldTestimonyDomains } from '../format.js'
  import { swarm } from '../layout.js'

  /** @typedef {import('../format.js').TestimonyDomainRow} TestimonyDomainRow */
  /** @type {{ rows: TestimonyDomainRow[], overall: number, outlet?: string, onPick: (domain: string) => void, width?: number }} */
  let { rows, overall, outlet = 'all', onPick, width = 860 } = $props()

  const PAD = 28
  const MAX_HEIGHT = 320
  const MIN_R = 3
  /** @param {number} n @param {number} w */
  const radius = (n, w) => Math.min(1, Math.max(0.55, w / 860)) * Math.min(30, 4 + 2.8 * Math.sqrt(n))

  const layout = $derived.by(() => {
    const inner = Math.max(80, width - 2 * PAD)
    /** @param {number} score */
    const x = (score) => PAD + (testimonyPosition(score) / 100) * inner
    const folded = foldTestimonyDomains(rows).map((d) => ({ ...d, x: x(d.score), r: radius(d.n, width) }))
    const smallest = folded.reduce((m, d) => Math.min(m, d.r), Infinity)
    const floor = smallest === Infinity ? 1 : Math.min(1, MIN_R / smallest)
    /** @param {number} k */
    const attempt = (k) => {
      const dots = swarm(folded.map((d) => ({ ...d, r: d.r * k })))
      const reach = dots.reduce((m, d) => Math.max(m, Math.abs(d.y) + d.r), 0)
      return { dots, half: Math.max(44, Math.ceil(reach) + 6) }
    }
    let scale = 1
    let fit = attempt(scale)
    while (fit.half * 2 > MAX_HEIGHT && scale > floor) {
      scale = Math.max(floor, scale * 0.92)
      fit = attempt(scale)
    }
    return { dots: fit.dots, x, half: fit.half, height: fit.half * 2 }
  })
</script>

{#if layout.dots.length && overall !== null && overall !== undefined}
  <figure class="strip">
    <div class="eyebrow">Veículos na régua</div>
    <div class="strip-mean-row">
      <span class="strip-mean" style="--pos:{testimonyPosition(overall)}%">média da pessoa {signed(overall)}</span>
    </div>
    <svg class="strip-svg" viewBox="0 0 {width} {layout.height}" {width} height={layout.height}
         role="group" aria-label="Veículos na régua da avaliação, de −10 a +10">
      <line class="strip-axis" x1={PAD} x2={width - PAD} y1={layout.half} y2={layout.half} />
      {#each [-10, -5, 0, 5, 10] as s}
        <line class="strip-tick" x1={layout.x(s)} x2={layout.x(s)} y1={layout.half - 5} y2={layout.half + 5} />
      {/each}
      <line class="strip-overall" x1={layout.x(overall)} x2={layout.x(overall)} y1="4" y2={layout.height - 4} />
      {#each layout.dots as d}
        <g class="strip-dot" class:is-active={d.domain === outlet}
           role="button" tabindex="0" aria-pressed={d.domain === outlet}
           aria-label="{d.domain}, {signed(d.score)} em {fmt(d.n)} textos"
           onclick={() => onPick(d.domain)}
           onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(d.domain) } }}>
          <title>{d.domain} · {d.sources.map((s) => sourceLabels[s] ?? s).join(', ')} · {signed(d.score)} em {fmt(d.n)} {d.n === 1 ? 'texto' : 'textos'}</title>
          <circle cx={d.x} cy={layout.half + d.y} r={d.r} style="--tone:{testimonyColor(d.score)}" />
        </g>
      {/each}
    </svg>
    <div class="strip-axis-labels"><span>−10 contra</span><span>0</span><span>+10 a favor</span></div>
    <p class="note">
      Uma bolinha por veículo com 3 ou mais textos avaliados; o tamanho é quantos textos.
      Toque numa bolinha para restringir o recorte a ela{outlet === 'all' ? '' : '; toque de novo para soltar'}.
    </p>
  </figure>
{/if}
