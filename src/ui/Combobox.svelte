<script lang="ts">
  import { filterItems, itemsOf, revealTop, type ComboItem } from './combobox.js'

  let { select, id }: { select: HTMLSelectElement; id: string } = $props()

  let input: HTMLInputElement | undefined = $state()
  let list: HTMLElement | undefined = $state()
  let text = $state('')
  let open = $state(false)
  let shown = $state.raw<ComboItem[]>([])
  let active = $state(-1)

  const itemsNow = () => itemsOf(select as unknown as Parameters<typeof itemsOf>[0])
  const labelOf = (value: string) => itemsNow().find((i) => i.value === value)?.label ?? ''
  export const sync = () => {
    text = labelOf(select.value)
  }

  const rows = $derived(shown.map((item, i) => ({ item, i, head: item.group !== '' && item.group !== (shown[i - 1]?.group ?? null) })))

  $effect(() => {
    sync()
    select.addEventListener('change', sync)
    return () => select.removeEventListener('change', sync)
  })

  $effect(() => {
    const row = list?.querySelector<HTMLElement>('.is-active')
    if (row && list && active >= 0) list.scrollTop = revealTop(row, { scrollTop: list.scrollTop, clientHeight: list.clientHeight })
  })

  const show = (query: string) => {
    shown = filterItems(itemsNow(), query)
    active = query ? (shown.length ? 0 : -1) : Math.max(0, shown.findIndex((i) => i.value === select.value))
    open = true
  }

  const close = () => {
    open = false
    active = -1
    sync()
  }

  const pick = (value: string) => {
    if (value !== select.value) {
      select.value = value
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }
    close()
  }

  const move = (delta: number) => {
    if (!open) return show('')
    if (!shown.length) return
    active = (active + delta + shown.length) % shown.length
  }

  const onkeydown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(-1)
    } else if (e.key === 'Enter') {
      if (!open) return
      e.preventDefault()
      const chosen = shown[active] ?? (shown.length === 1 ? shown[0] : undefined)
      if (chosen) pick(chosen.value)
    } else if (e.key === 'Escape') {
      if (!open) return
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'Tab') {
      if (open) close()
    }
  }

  const onmousedown = (e: MouseEvent) => {
    e.preventDefault()
    const option = (e.target as Element | null)?.closest?.('[data-value]') as HTMLElement | null
    if (option?.dataset.value !== undefined) pick(option.dataset.value)
  }
</script>

<input
  {id}
  class="combo-input"
  type="text"
  autocomplete="off"
  spellcheck="false"
  role="combobox"
  placeholder="Buscar…"
  aria-autocomplete="list"
  aria-expanded={open}
  aria-controls="{id}List"
  aria-activedescendant={active >= 0 ? `${id}List-${active}` : ''}
  bind:this={input}
  value={text}
  onfocus={() => {
    show('')
    input?.select()
  }}
  onclick={() => {
    if (!open) show('')
  }}
  oninput={(e) => {
    text = e.currentTarget.value
    show(text)
  }}
  onblur={() => {
    if (open) close()
  }}
  {onkeydown}
/>
<!-- svelte-ignore a11y_no_static_element_interactions, a11y_interactive_supports_focus -->
<span id="{id}List" class="combo-list" role="listbox" hidden={!open} bind:this={list} {onmousedown}>
  {#if !shown.length}
    <span class="combo-empty">Nada com esse nome</span>
  {:else}
    {#each rows as { item, i, head } (i)}
      {#if head}<span class="combo-group eyebrow" role="presentation">{item.group}</span>{/if}
      <span class="combo-option" class:is-active={i === active} role="option" id="{id}List-{i}" data-value={item.value} aria-selected={item.value === select.value}>{item.label}</span>
    {/each}
  {/if}
</span>
