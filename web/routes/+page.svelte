<svelte:head>
<title>rashomon · atlas</title>
</svelte:head>

<script lang="ts">
  import { onMount } from 'svelte'
  import Agenda from '$lib/Agenda.svelte'
  import Atlas from '$lib/Atlas.svelte'
  import Lenses from '$lib/Lenses.svelte'
  import Compare from '$lib/Compare.svelte'
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

  <section class="figure rising" id="rising" aria-labelledby="risingTitle">
    <header class="figure-head">
      <div class="figure-title"><span class="eyebrow">Gráfico 4</span><h2 id="risingTitle">Em alta</h2></div>
      <p class="figure-sub">As palavras mais presentes na semana, e se cada uma ocupa fatia maior ou menor do que se escreve sobre a pessoa. <a href="/como-ler#em-alta">Como ler</a>.</p>
      <dl class="figure-key">
        <div><dt>Posição</dt><dd>fatia da palavra em tudo o que se escreve sobre a pessoa, agora contra antes; no meio, a mesma fatia</dd></div>
        <div><dt>Tamanho</dt><dd>textos nos 37 dias</dd></div>
        <div><dt><span class="key-pair" aria-hidden="true"></span>Cor</dt><dd>para que lado pende</dd></div>
        <div><dt>Clique</dt><dd>textos da semana</dd></div>
        <div><dt>Lista</dt><dd>fora da régua, as que subiram de fato, da maior subida para a menor</dd></div>
      </dl>
      <div class="sentence"><p class="sentence-line">O que se escreve sobre <span class="pick"><select id="risingPerson" aria-label="Pessoa (em alta)"></select></span> nos últimos 7 dias, contra os 30 dias antes, em <span class="keep"><span class="pick"><select id="risingSource" aria-label="Fonte (em alta)"></select></span>.</span></p></div>
    </header>
    <figure class="ruler" id="risingRuler" aria-label="Régua de termos em alta" hidden></figure>
    <p class="note" id="risingAbout"></p>
  </section>

  <Week />

  <Lenses />

  <Attention />

  <Agenda />

  <Comention />
  <Persistence />
</main>
<DocsCard />
<HelpDialog />
