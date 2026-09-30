<script lang="ts">
  let n = $state(0)
  let el: HTMLParagraphElement | undefined = $state()

  $effect(() => {
    el?.setAttribute('data-parity', n % 2 === 0 ? 'par' : 'impar')
  })
</script>

<button type="button" onclick={() => n++}>Contar</button>
<p bind:this={el}>Cliques: {n}</p>
