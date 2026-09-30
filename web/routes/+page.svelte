<svelte:head>
<title>rashomon · atlas</title>
</svelte:head>

<script lang="ts">
  import { onMount } from 'svelte'
  import Agenda from '$lib/Agenda.svelte'
  import Atlas from '$lib/Atlas.svelte'
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

  <section class="figure lenses" id="lenses" aria-labelledby="lensesTitle">
    <header class="figure-head">
      <div class="figure-title"><span class="eyebrow">Gráfico 6</span><h2 id="lensesTitle">Uma pessoa, duas lentes</h2></div>
      <p class="figure-sub">A mesma pessoa lida por dois recortes ao mesmo tempo: um veículo, um viés ou uma fonte contra outro. <a href="/como-ler#lentes">Como ler</a>.</p>
      <dl class="figure-key">
        <div><dt>Posição</dt><dd>de qual lente a palavra é mais</dd></div>
        <div><dt>Tamanho</dt><dd>documentos das duas lentes, somados</dd></div>
        <div><dt><span class="key-pair" aria-hidden="true"></span>Cor</dt><dd>para que lente ela pende</dd></div>
        <div><dt><span class="key-bridge" aria-hidden="true"></span>Ponte</dt><dd>palavra que liga o vocabulário das duas lentes</dd></div>
        <div><dt>Clique</dt><dd>textos das duas lentes, neste gráfico</dd></div>
      </dl>
      <div class="sentence"><p class="sentence-line">Comparar <span class="pick"><select id="lensesPerson" aria-label="Pessoa (lentes)"></select></span> sob <span class="pick"><select id="lensesA" aria-label="Lente A">
        <option value="all">Tudo</option>
        <optgroup label="Veículo" id="lensesAOutlets"></optgroup>
        <optgroup label="Viés"><option value="lean:left">Esquerda</option><option value="lean:center">Centro</option><option value="lean:right">Direita</option></optgroup>
        <optgroup label="Fonte"><option value="source:bluesky">Bluesky</option><option value="source:gdelt">GDELT</option><option value="source:rss">RSS</option><option value="source:gnews">Google News</option><option value="source:gkg">GKG</option><option value="source:camara">Câmara</option><option value="source:senado">Senado</option><option value="source:juridico">Jurídico</option><option value="source:oficial">Oficial</option><option value="source:nicho">Nicho</option></optgroup>
      </select><input id="lensesAInput" class="combo-input" type="text" hidden autocomplete="off" spellcheck="false" role="combobox" aria-label="Lente A" placeholder="Buscar…" aria-autocomplete="list" aria-expanded="false" aria-controls="lensesAList"><span id="lensesAList" class="combo-list" role="listbox" aria-label="Opções da lente A" hidden></span></span> e <span class="keep"><span class="pick"><select id="lensesB" aria-label="Lente B">
        <option value="all">Tudo</option>
        <optgroup label="Veículo" id="lensesBOutlets"></optgroup>
        <optgroup label="Viés"><option value="lean:left">Esquerda</option><option value="lean:center">Centro</option><option value="lean:right">Direita</option></optgroup>
        <optgroup label="Fonte"><option value="source:bluesky">Bluesky</option><option value="source:gdelt">GDELT</option><option value="source:rss">RSS</option><option value="source:gnews">Google News</option><option value="source:gkg">GKG</option><option value="source:camara">Câmara</option><option value="source:senado">Senado</option><option value="source:juridico">Jurídico</option><option value="source:oficial">Oficial</option><option value="source:nicho">Nicho</option></optgroup>
      </select><input id="lensesBInput" class="combo-input" type="text" hidden autocomplete="off" spellcheck="false" role="combobox" aria-label="Lente B" placeholder="Buscar…" aria-autocomplete="list" aria-expanded="false" aria-controls="lensesBList"><span id="lensesBList" class="combo-list" role="listbox" aria-label="Opções da lente B" hidden></span></span>,</span> nos últimos <span class="keep"><span class="pick"><select id="lensesDays" aria-label="Período (lentes)"><option value="7">7 dias</option><option value="30" selected>30 dias</option><option value="60">60 dias</option></select></span>.</span> Mostrar <span class="pick"><select id="lensesLimit" aria-label="Quantidade de palavras (lentes)">
        <option value="20">20</option><option value="40" selected>40</option><option value="60">60</option><option value="100">100</option>
      </select></span> palavras.</p></div>
    </header>
    <p class="status" id="lensesStatus" role="status" hidden>Os dois lados mostram o mesmo recorte.</p>
    <figure class="ruler" id="lensesRuler" aria-label="Régua comparando duas lentes da mesma pessoa" hidden></figure>
    <div class="detail" id="lensesDetail"><span class="empty-hint">Clique numa palavra para ver os números das duas lentes.</span></div>
    <p class="note" id="lensesHiddenNote" hidden></p>
  </section>

  <Attention />

  <Agenda />

  <Comention />
  <Persistence />
</main>
<DocsCard />
<HelpDialog />
