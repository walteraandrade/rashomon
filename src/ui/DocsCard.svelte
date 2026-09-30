<script lang="ts">
  import { attach, card, close, onNativeClose, onResize, startDrag } from './docs-card.svelte.js'

  let dialog: HTMLDialogElement | undefined = $state()

  $effect(() => {
    if (!dialog) return
    attach(dialog)
    let pending: ReturnType<typeof setTimeout> | undefined
    const resize = () => {
      clearTimeout(pending)
      pending = setTimeout(onResize, 150)
    }
    window.addEventListener('resize', resize)
    return () => {
      clearTimeout(pending)
      window.removeEventListener('resize', resize)
      attach(null)
    }
  })
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
  class="docs-dialog"
  class:is-floating={card.isFloating}
  class:is-wide={card.sides.length === 2}
  id="docsDialog"
  aria-labelledby="docsTitle"
  bind:this={dialog}
  style:left={card.spot ? `${card.spot.x}px` : null}
  style:top={card.spot ? `${card.spot.y}px` : null}
  onclick={(event) => event.target === dialog && close()}
  onclose={onNativeClose}
>
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_missing_content -->
  <div class="docs-dialog-head" id="docsGrip" onpointerdown={startDrag}><div><span class="eyebrow" id="docsKicker">Documentos</span><h2 id="docsTitle"></h2></div><button id="docsClose" class="quiet-button" aria-label="Fechar documentos" onclick={close}>Fechar</button></div>
  <div id="docs" aria-live="polite"></div>
</dialog>
