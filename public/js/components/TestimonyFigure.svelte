<script>
  import { fmt, mergeOutlets, signed, sourceLabels, testimonyClass, testimonyColor, testimonyFocus } from '../format.js'
  import Strip from './Strip.svelte'

  /** @typedef {import('../format.js').Testimony} Testimony */
  /** @typedef {import('../format.js').OutletRow} OutletRow */

  // Both payloads arrive on their own schedule and either may still be missing; `person` is
  // here only so a new person drops the outlet in focus.
  /** @type {{ testimony?: Testimony | null, outletRows?: OutletRow[] | null, status?: 'loading' | 'ready' | 'error', person?: string, width?: number, initialOutlet?: string }} */
  let { testimony = null, outletRows = null, status = 'loading', person = '', width = 860, initialOutlet = 'all' } = $props()

  // The outlet in focus. It never leaves this component, so it cannot reach api.js's
  // querystring builder: picking an outlet is a reading inside this figure and stops here.
  // `initialOutlet` only seeds it, so a test can render a focused figure without a click.
  // svelte-ignore state_referenced_locally
  let outlet = $state(initialOutlet)

  $effect(() => {
    person
    outlet = initialOutlet
  })

  // Carries "the fetch finished" and "there is something to draw" at once, with the score
  // narrowed, so every branch below reads one value instead of re-testing three.
  const ready = $derived.by(() => {
    if (status !== 'ready' || !testimony) return null
    const { score, n } = testimony.overall
    return score === null || score === undefined || !n ? null : { ...testimony, overall: { score, n } }
  })
  const focus = $derived(ready ? testimonyFocus(ready.by_domain, outlet) : null)
  const merged = $derived(mergeOutlets(outletRows ?? [], testimony?.by_domain ?? []))

  /** @param {string} d */
  const pick = (d) => { outlet = d === outlet ? 'all' : d }

  // A click on empty space inside the figure releases the outlet, the way a click on the empty
  // map releases the selected term.
  /** @param {MouseEvent} e */
  const background = (e) => {
    const target = /** @type {Element | null} */ (e.target)
    if (outlet !== 'all' && !target?.closest('[data-domain], [data-strip-domain]')) outlet = 'all'
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<section class="figure testimony" id="testimony" aria-labelledby="testimonyTitle" onclick={background}>
  <header class="figure-head">
    <div class="figure-title">
      <span class="eyebrow">Gráfico 2</span>
      <h2 id="testimonyTitle">Avaliação por veículo <b>{ready ? signed(ready.overall.score) : ''}</b></h2>
    </div>
    <p class="figure-sub">
      Cada bolinha é um veículo na nota média que o modelo kikori dá aos textos dele sobre a pessoa,
      de −10 (contra) a +10 (a favor). O tamanho é quantos textos. Compare veículos falando da mesma
      pessoa; nunca compare pessoas. <a href="como-ler.html#avaliacao">Como ler este gráfico</a>.
    </p>
  </header>

  {#if ready}
    <Strip rows={ready.by_domain} overall={ready.overall.score} {outlet} onPick={pick} {width} />
  {/if}

  <div class="testimony-lists">
    {#if status === 'loading'}
      Carregando…
    {:else if status === 'error'}
      <p class="note">Não foi possível carregar a avaliação.</p>
    {:else if !ready}
      <p class="note">Nenhum texto avaliado neste recorte (método {testimony?.method}).</p>
    {:else}
      <div class="verdict">
        <strong style="--tone:{testimonyColor(ready.overall.score)}">{signed(ready.overall.score)}</strong>
        <span>{testimonyClass(ready.overall.score)} · média de {fmt(ready.overall.n)} {ready.overall.n === 1 ? 'texto avaliado' : 'textos avaliados'}</span>
      </div>

      {#if outlet !== 'all'}
        <p class="focus">
          <b>{outlet}</b>:
          {#if focus}
            <strong style="--tone:{testimonyColor(focus.score)}">{signed(focus.score)}</strong>
            em {fmt(focus.n)} {focus.n === 1 ? 'texto' : 'textos'}.
          {:else}
            menos de 3 textos avaliados, sem média própria.
          {/if}
          O número acima é o recorte inteiro.
        </p>
      {/if}

      <div class="source-chips">
        {#each ready.by_source as r}
          <span class="source-chip">
            <b>{sourceLabels[r.source] ?? r.source}</b>
            <span class="n">{fmt(r.n)}</span>
            <span class="t" style="--tone:{testimonyColor(r.score)}">{r.score == null ? '' : signed(r.score)}</span>
          </span>
        {/each}
      </div>
    {/if}
  </div>

  <div class="outlets">
    <p class="eyebrow">Veículos do recorte <b>{outlet === 'all' ? '' : ` · ${outlet}`}</b></p>
    {#if merged.length}
      <div class="outlet-grid">
        {#each merged as r}
          <button class="outlet" class:is-active={r.domain === outlet}
                  data-domain={r.domain} aria-pressed={r.domain === outlet}
                  title={r.sources.map((x) => sourceLabels[x] ?? x).join(', ')}
                  onclick={() => pick(r.domain)}>
            <span class="d">{r.domain}</span>
            <span class="n">{fmt(r.docs)}</span>
            <span class="t" style="--tone:{testimonyColor(r.score)}">{r.score === null ? '' : signed(r.score)}</span>
          </button>
        {/each}
      </div>
      <p class="note">
        Documentos no recorte e, quando o veículo tem 3 ou mais textos avaliados, a nota de −10 a +10
        que o modelo kikori ({testimony?.method ?? ''}) dá a cada texto sobre a pessoa. Compare veículos
        falando da mesma pessoa; não compare pessoas entre si.
      </p>
    {:else}
      <p class="note">Nenhum veículo neste recorte.</p>
    {/if}
  </div>
</section>
