<script>
  import { fmt, signed, sourceLabels, testimonyColor, testimonyPosition } from '../format.js'
  import { STRIP_PAD, stripLayout } from '../layout.js'

  /** @typedef {import('../format.js').TestimonyDomainRow} TestimonyDomainRow */
  /** @type {{ rows: TestimonyDomainRow[], overall: number, outlet?: string, onPick: (domain: string) => void, width?: number }} */
  let { rows, overall, outlet = 'all', onPick, width = 860 } = $props()

  const layout = $derived(stripLayout(rows, width))

</script>

{#if layout.dots.length && overall !== null && overall !== undefined}
  <figure class="strip">
    <div class="eyebrow">Veículos na régua</div>
    <div class="strip-mean-row">
      <span class="strip-mean" style="--pos:{testimonyPosition(overall)}%">média da pessoa {signed(overall)}</span>
    </div>
    <svg class="strip-svg" viewBox="0 0 {width} {layout.height}" {width} height={layout.height}
         role="group" aria-label="Veículos na régua da avaliação, de −10 a +10">
      <line class="strip-axis" x1={STRIP_PAD} x2={width - STRIP_PAD} y1={layout.half} y2={layout.half} />
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
