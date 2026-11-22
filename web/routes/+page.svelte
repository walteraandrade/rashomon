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
  import { loadLabels, loadPeople } from '$lib/api.js'
  import { setLabels } from '$lib/format.js'
  import { setBoot, type Person } from '$lib/boot.svelte.js'

  onMount(async () => {
    setBoot({ search: location.search })
    let people: Person[] = []
    let peopleError: unknown = null
    // Labels only respell words; a failure or a slow answer leaves the stored spelling, never blocks the page.
    const labels = loadLabels().then(setLabels, () => {})
    try {
      people = await loadPeople()
    } catch (e) {
      peopleError = e
    }
    await Promise.race([labels, new Promise((r) => setTimeout(r, 1500))])
    // Words are measured on a canvas before they are drawn; measuring in the fallback face would
    // pack them for the wrong widths. Wait for the word face, never longer than a moment.
    await Promise.race([document.fonts?.load?.("500 20px 'Newsreader'"), new Promise((r) => setTimeout(r, 1500))]).catch(() => {})
    setBoot({ people, peopleError, ready: true })
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
