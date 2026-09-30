<svelte:head>
<title>rashomon · atlas</title>
</svelte:head>

<script lang="ts">
  import { onMount } from 'svelte'
  import Agenda from '$lib/Agenda.svelte'
  import Comention from '$lib/Comention.svelte'
  import DocsCard from '$lib/DocsCard.svelte'
  import HelpDialog from '$lib/HelpDialog.svelte'

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
  <section class="figure workspace" id="workspace" aria-labelledby="atlasTitle">
    <header class="figure-head">
      <div class="figure-title"><span class="eyebrow">Gráfico 1</span><h2 id="atlasTitle">Atlas de palavras <b id="atlasStats"></b></h2></div>
      <p class="figure-sub">Palavras nos textos que citam a pessoa. A posição só evita colisão. <a href="/como-ler#atlas">Como ler</a>.</p>
      <dl class="figure-key" id="keyDefault">
        <div><dt><span class="type-scale" aria-hidden="true"><span>Aa</span><span>Aa</span></span>Tamanho</dt><dd>frequência, PMI ou alcance, o que a frase escolhe</dd></div>
        <div id="keyDefaultColor"><dt><span class="mask-scale" aria-hidden="true"></span>Cor</dt><dd>avaliação contra a média desta pessoa</dd></div>
        <div><dt>Posição</dt><dd>só evita colisão</dd></div>
        <div><dt>Tracejado</dt><dd>organização citada no texto, só no GDELT</dd></div>
        <div><dt>Clique</dt><dd>textos da palavra; no centro e na lista, textos da pessoa</dd></div>
      </dl>
      <dl class="figure-key" id="keyTheme" hidden>
        <div><dt><span class="theme-scale" aria-hidden="true"></span>Cor</dt><dd id="keyThemeText">tema: palavras que caminharam juntas nesta construção</dd></div>
      </dl>
      <dl class="figure-key" id="keyStrip" hidden>
        <div><dt>Posição</dt><dd>média da avaliação dos textos com a palavra</dd></div>
        <div><dt><span class="type-scale" aria-hidden="true"><span>Aa</span><span>Aa</span></span>Tamanho</dt><dd>quantos textos</dd></div>
        <div><dt><span class="mask-scale" aria-hidden="true"></span>Cor</dt><dd>distância da média da pessoa</dd></div>
        <div><dt>Clique</dt><dd>textos da palavra</dd></div>
      </dl>
      <div class="sentence">
        <p class="sentence-line">Palavras ligadas a <span class="pick"><select id="person" aria-label="Pessoa"></select></span> nos <span class="keep"><span class="pick"><select id="days" aria-label="Período"><option value="7">últimos 7 dias</option><option value="30" selected>últimos 30 dias</option><option value="60">últimos 60 dias</option></select></span>,</span> em <span class="keep"><span class="pick"><select id="source" aria-label="Fonte"></select></span>,</span> por <span class="keep"><span class="pick"><select id="sort" aria-label="Tamanho por"><option value="count">frequência</option><option value="pmi" selected>PMI ponderado</option><option value="reach">alcance</option></select></span>.</span> Mostrar <span class="pick"><select id="limit" aria-label="Quantidade de palavras"><option>12</option><option selected>18</option><option>24</option></select></span> palavras.</p>
        <p class="status-row"><span class="status" id="status" role="status"></span></p>
      </div>
    </header>
    <div class="map-tools"><label class="search"><input id="search" type="search" placeholder="Encontrar uma palavra no recorte…" aria-label="Encontrar uma palavra no recorte"></label><div class="segment" role="group" aria-label="Modo de leitura"><button id="modeMap" aria-pressed="true">Mapa</button><button id="modeColumns" aria-pressed="false">Lista</button><button id="modeStrip" aria-pressed="false">Avaliação</button></div><button id="mask" class="quiet-button toggle" aria-pressed="true">Colorir por avaliação</button><div class="zoom" id="zoomGroup" aria-label="Zoom do mapa"><button id="zoomOut" class="quiet-button" aria-label="Diminuir zoom">−</button><button id="zoomReset" class="quiet-button" aria-label="Restaurar zoom">100%</button><button id="zoomIn" class="quiet-button" aria-label="Aumentar zoom">+</button></div><button id="clear" class="quiet-button">Limpar seleção</button></div>
    <div class="figure-body">
      <div class="canvas">
        <p class="mobile-hint">Arraste o mapa para os lados para ver o círculo inteiro.</p>
        <div id="searchNote" class="search-note" role="status"></div>
        <div class="viewport" id="viewport" role="region" aria-label="Mapa circular interativo. Use Tab para navegar pelas palavras; em telas pequenas, role horizontalmente." tabindex="0"></div>
        <div class="overflow" id="overflow" hidden></div>
        <div id="columns" class="columns" hidden></div>
        <figure class="strip" id="atlasStrip" aria-label="Palavras na régua da avaliação" hidden></figure>
        <p class="note" id="stripHiddenNote" hidden></p>
        <div class="legend" id="legend"></div>
      </div>
      <aside class="inspector" id="inspector" aria-label="Detalhes da pessoa ou da palavra"></aside>
    </div>
  </section>
  <div id="selectionNote" class="sr-only" role="status"></div>

  <section class="figure testimony" id="testimony" aria-labelledby="testimonyTitle">
    <header class="figure-head">
      <div class="figure-title"><span class="eyebrow">Gráfico 2</span><h2 id="testimonyTitle">Avaliação por veículo <b id="testimonyLabel"></b></h2></div>
      <p class="figure-sub">Compare veículos falando da mesma pessoa. Nunca compare pessoas. <a href="/como-ler#avaliacao">Como ler</a>.</p>
      <dl class="figure-key">
        <div><dt>Posição</dt><dd>nota do kikori, um modelo treinado para ler se o texto é contra (−10) ou a favor (+10)</dd></div>
        <div><dt>Tamanho</dt><dd>quantos textos o veículo tem</dd></div>
        <div><dt>Clique</dt><dd>textos daquele veículo, só neste gráfico</dd></div>
      </dl>
      <div class="sentence"><p class="sentence-line">Avaliação por veículo sobre <span class="pick"><select id="testimonyPerson" aria-label="Pessoa (avaliação por veículo)"></select></span> nos <span class="keep"><span class="pick"><select id="testimonyDays" aria-label="Período (avaliação por veículo)"><option value="7">últimos 7 dias</option><option value="30" selected>últimos 30 dias</option><option value="60">últimos 60 dias</option></select></span>,</span> em <span class="keep"><span class="pick"><select id="testimonySource" aria-label="Fonte (avaliação por veículo)"></select></span>.</span></p></div>
    </header>
    <figure class="strip" id="strip" aria-label="Veículos na régua da avaliação" hidden></figure>
    <div class="testimony-lists" id="testimonyList">Aguardando dados.</div>
    <div class="outlets" id="outlets"><p class="eyebrow">Veículos do recorte <b id="domainLabel"></b></p><div id="outletList">Aguardando dados.</div></div>
  </section>

  <section class="figure compare" id="compare" aria-labelledby="compareTitle">
    <header class="figure-head">
      <div class="figure-title"><span class="eyebrow">Gráfico 3</span><h2 id="compareTitle">Régua entre duas pessoas</h2></div>
      <p class="figure-sub">A palavra escrita na régua nunca é de uma pessoa só. <a href="/como-ler#comparar">Como ler</a>.</p>
      <dl class="figure-key">
        <div><dt>Posição</dt><dd>de quem a palavra é mais</dd></div>
        <div><dt>Tamanho</dt><dd>documentos dos dois, somados</dd></div>
        <div><dt><span class="key-pair" aria-hidden="true"></span>Cor</dt><dd>de que lado ela pende</dd></div>
        <div><dt><span class="key-bridge" aria-hidden="true"></span>Ponte</dt><dd>liga os dois vocabulários</dd></div>
        <div><dt>Clique</dt><dd>textos das duas pessoas, neste gráfico</dd></div>
      </dl>
      <div class="sentence"><p class="sentence-line">Comparar <span class="pick"><select id="compareA" aria-label="Pessoa A"></select></span> com <span class="pick"><select id="compareB" aria-label="Pessoa B"></select></span> nos <span class="keep"><span class="pick"><select id="compareDays" aria-label="Período"><option value="7">últimos 7 dias</option><option value="30" selected>últimos 30 dias</option><option value="60">últimos 60 dias</option></select></span>,</span> em <span class="keep"><span class="pick"><select id="compareSource" aria-label="Fonte"></select></span>,</span> por <span class="keep"><span class="pick"><select id="compareMeasure" aria-label="Medida"></select></span>.</span> Mostrar <span class="pick"><select id="compareLimit" aria-label="Quantidade de palavras"></select></span> palavras por pessoa.</p></div>
    </header>
    <p class="status" id="compareStatus" role="status" hidden>Os dois lados mostram a mesma pessoa.</p>
    <figure class="ruler" id="compareRuler" aria-label="Régua comparando as duas pessoas" hidden></figure>
    <div class="detail" id="compareDetail"><span class="empty-hint">Clique numa palavra para ver os números dos dois lados.</span></div>
    <p class="note" id="compareHiddenNote" hidden></p>
  </section>

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

  <section class="figure week" id="week" aria-labelledby="weekTitle">
    <header class="figure-head">
      <div class="figure-title"><span class="eyebrow">Gráfico 5</span><h2 id="weekTitle">A semana</h2></div>
      <p class="figure-sub">Quais palavras ocuparam cada dia dos últimos sete. <a href="/como-ler#semana">Como ler</a>.</p>
      <dl class="figure-key">
        <div><dt><span class="type-scale" aria-hidden="true"><span>Aa</span><span>Aa</span></span>Tamanho</dt><dd>documentos naquele dia</dd></div>
        <div><dt>Posição</dt><dd>só o dia; a altura na coluna não mede nada</dd></div>
        <div><dt>Clique</dt><dd>os textos daquele dia</dd></div>
      </dl>
      <div class="sentence"><p class="sentence-line">Na semana de <span class="keep"><span class="pick"><select id="weekPerson" aria-label="Pessoa (semana)"></select></span>,</span> em <span class="keep"><span class="pick"><select id="weekSource" aria-label="Fonte (semana)"></select></span>,</span> as palavras que mais ocuparam cada dia. Mostrar <span class="pick"><select id="weekLimit" aria-label="Quantidade de palavras por dia"><option>5</option><option selected>8</option><option>12</option></select></span> palavras por dia.</p></div>
    </header>
    <figure class="week-chart" id="weekChart" aria-label="Palavras da semana, uma coluna por dia" hidden></figure>
    <p class="note" id="weekNote"></p>
  </section>

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

  <section class="figure attention" id="attention" aria-labelledby="attentionTitle">
    <header class="figure-head">
      <div class="figure-title"><span class="eyebrow">Gráfico 7</span><h2 id="attentionTitle">Atenção e menções</h2></div>
      <p class="figure-sub">Quanto se buscou o nome na Wikipédia contra quanto se escreveu sobre a pessoa, dia a dia. <a href="/como-ler#atencao">Como ler</a>.</p>
      <dl class="figure-key">
        <div><dt>Posição</dt><dd>o dia, o mesmo eixo nas duas linhas</dd></div>
        <div><dt>Tamanho</dt><dd>altura da barra, numa escala só de cada linha</dd></div>
        <div><dt>Clique</dt><dd>documentos do dia, em qualquer das duas linhas</dd></div>
      </dl>
      <div class="sentence"><p class="sentence-line">Curiosidade e menções sobre <span class="pick"><select id="attentionPerson" aria-label="Pessoa (atenção)"></select></span> nos últimos 30 dias, em <span class="keep"><span class="pick"><select id="attentionSource" aria-label="Fonte (atenção)"></select></span>.</span></p></div>
    </header>
    <p class="note" id="attentionNote"></p>
    <figure class="attention-chart" id="attentionChart" aria-label="Pageviews da Wikipédia e menções por dia" hidden></figure>
  </section>

  <Agenda />

  <Comention />
  <section class="figure persistence" id="persistence" aria-labelledby="persistenceTitle">
    <header class="figure-head">
      <div class="figure-title"><span class="eyebrow">Gráfico 10</span><h2 id="persistenceTitle">Persistência</h2></div>
      <p class="figure-sub">Quais palavras grudaram na pessoa semana após semana, e quais sumiram. <a href="/como-ler#persistencia">Como ler</a>.</p>
      <dl class="figure-key">
        <div><dt>Palavra</dt><dd>uma linha por palavra, das que ficaram mais tempo às que ficaram menos</dd></div>
        <div><dt><span class="ink-scale" aria-hidden="true"></span>Célula</dt><dd>uma semana; a tinta é o número de documentos</dd></div>
        <div><dt><span class="persistence-gap-swatch" aria-hidden="true"></span>Vazia</dt><dd>fora das 50 palavras mais fortes da semana; não é zero</dd></div>
        <div><dt>Sequência</dt><dd>semanas seguidas com a palavra, até agora</dd></div>
        <div><dt>Meia-vida</dt><dd>semanas do pico até cair à metade; &ldquo;sem queda&rdquo; se ainda não caiu</dd></div>
        <div><dt>Clique</dt><dd>os textos daquela semana</dd></div>
        <div><dt>Início</dt><dd id="persistenceSince">a série começa em 9 de set. de 2026</dd></div>
      </dl>
      <div class="sentence"><p class="sentence-line">As palavras que ficaram com <span class="keep"><span class="pick"><select id="persistencePerson" aria-label="Pessoa (persistência)"></select></span>,</span> nas últimas <span class="keep"><span class="pick"><select id="persistenceWeeks" aria-label="Semanas (persistência)"><option value="4">4 semanas</option><option value="12" selected>12 semanas</option><option value="26">26 semanas</option></select></span>.</span> Mostrar <span class="pick"><select id="persistenceLimit" aria-label="Quantidade de palavras (persistência)"><option value="20">20</option><option value="40" selected>40</option><option value="60">60</option></select></span> palavras.</p></div>
    </header>
    <figure class="persistence-chart" id="persistenceChart" aria-label="Palavras por semana, com sequência e meia-vida" hidden></figure>
    <p class="note" id="persistenceNote"></p>
  </section>
</main>
<DocsCard />
<HelpDialog />
