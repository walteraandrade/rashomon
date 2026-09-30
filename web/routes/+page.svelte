<svelte:head>
<title>rashomon · atlas</title>
</svelte:head>

<script lang="ts">
  import { onMount } from 'svelte'
  import Agenda from '$lib/Agenda.svelte'
  import Atlas from '$lib/Atlas.svelte'
  import Lenses from '$lib/Lenses.svelte'
  import Compare from '$lib/Compare.svelte'
  import Rising from '$lib/Rising.svelte'
  import Comention from '$lib/Comention.svelte'
  import Attention from '$lib/Attention.svelte'
  import DocsCard from '$lib/DocsCard.svelte'
  import Persistence from '$lib/Persistence.svelte'
  import HelpDialog from '$lib/HelpDialog.svelte'
  import Week from '$lib/Week.svelte'
  import Testimony from '$lib/Testimony.svelte'

  onMount(async () => {
    const { boot } = await import('$lib/app.js')
    boot()
  })
</script>

<a class="skip" href="#workspace">Ir ao atlas</a>
<header class="top"><a class="brand" href="/"><img src="/rashomon-mark.svg" alt="" width="28" height="28">rashomon<span>.</span></a><div class="person-pick"></div><nav><a class="help-link" href="/como-ler">como ler</a><a class="help-link" href="/sobre">sobre</a></nav></header>
<main>
  <header class="masthead">
    <p class="eyebrow">Rashomon · atlas</p>
    <h1>A mesma pessoa, muitas versões</h1>
    <p class="lede">Posts, notícias e discursos que citam um nome. Que palavras grudam nele, quem diz, com que tom, contra quem, e como isso muda de uma semana para a outra.</p>
  </header>
  <Atlas />

  <Testimony />

  <Compare />

  <Rising />

  <Week />

  <Lenses />

  <Attention />

  <Agenda />

  <Comention />
  <Persistence />
</main>
<DocsCard />
<HelpDialog />
