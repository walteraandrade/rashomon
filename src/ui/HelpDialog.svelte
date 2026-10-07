<script lang="ts">
  import { attachHelp, closeHelp, onGuideClick } from './help.svelte.js'

  let dialog: HTMLDialogElement | undefined = $state()

  $effect(() => {
    if (!dialog) return
    attachHelp(dialog)
    document.addEventListener('click', onGuideClick)
    return () => {
      document.removeEventListener('click', onGuideClick)
      attachHelp(null)
    }
  })
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog class="help-dialog" id="helpDialog" aria-labelledby="helpTitle" bind:this={dialog} onclick={(event) => event.target === dialog && closeHelp()}>
  <div class="help-dialog-head"><div><span class="eyebrow">Guia</span><h2 id="helpTitle">Como ler</h2></div><button id="helpClose" class="quiet-button" aria-label="Fechar o guia" onclick={closeHelp}>Fechar</button></div>
  <div class="help-body">
    <p>Tudo vale só para o recorte da frase: pessoa, período, fonte.</p>
    <div id="help-analise">
      <h3>Uma análise</h3>
      <ol>
        <li>Escolha pessoa, período e fonte na frase.</li>
        <li>Leia as palavras maiores. Clique numa para ver os textos.</li>
        <li>No gráfico 2, compare veículos da mesma pessoa. No 3, de quem a palavra é. No 4, o que ganhou ou perdeu espaço esta semana. No 5, em que dia da semana cada palavra apareceu. No 6, leia a mesma pessoa por dois recortes ao mesmo tempo. No 7, veja a fatia de cada veículo por pessoa.</li>
      </ol>
    </div>
    <div id="help-atlas">
      <h3>Gráfico 1 · Atlas</h3>
      <dl class="figure-key">
        <div><dt>Tamanho</dt><dd>frequência, PMI ou alcance, o que a frase escolhe</dd></div>
        <div><dt>Cor</dt><dd>avaliação contra a média desta pessoa</dd></div>
        <div><dt>Posição</dt><dd>só evita colisão</dd></div>
        <div><dt>Tracejado</dt><dd>organização citada no texto, só no GDELT</dd></div>
        <div><dt>Clique</dt><dd>textos da palavra; no centro e na lista, textos da pessoa</dd></div>
      </dl>
      <p>Alcance é a soma dos reposts dos posts do Bluesky que trazem a palavra. É contado quando o rashomon coletou o post, então um post que continuou circulando depois fica subcontado. Só documentos do Bluesky têm alcance; os das outras fontes não têm e contam como zero.</p>
      <p>Cinza: igual à média, ou menos de 3 textos avaliados. Linha entre duas palavras: estão nos mesmos textos. Só isso.</p>
      <p>No modo <b>Avaliação</b> a posição passa a ser a média das notas dos textos com a palavra; a cor continua a mesma máscara.</p>
      <p>Uma expressão é várias palavras como um termo só. Ela substitui as palavras que cobre; a contagem de uma palavra passa a ser os textos em que ela aparece fora de qualquer expressão.</p>
      <p>Textos vindos do GDELT também trazem organizações citadas na matéria (ministérios, partidos, empresas): um quarto tipo de termo, com sublinhado tracejado. Vem só do GDELT e nunca é inventado para as outras fontes.</p>
      <p>Clique numa palavra abre os textos. No nome no centro, e na primeira linha da lista, abre os da pessoa. O cartão fica aberto na próxima escolha e arrasta pelo topo.</p>
    </div>
    <div id="help-pmi">
      <h3>PMI</h3>
      <p>Frequência conta. PMI pergunta se a palavra aparece mais do que apareceria por acaso. “presidente” é comum; uma palavra quase só desta pessoa tem PMI alto.</p>
      <dl class="pmi-scale">
        <div><dt>0</dt><dd>igual ao acaso</dd></div>
        <div><dt>1</dt><dd>o dobro</dd></div>
        <div><dt>2</dt><dd>quatro vezes</dd></div>
        <div><dt>3</dt><dd>oito vezes</dd></div>
      </dl>
      <p>PMI ponderado segura a palavra rara: PMI × ln(1 + documentos).</p>
    </div>
    <div id="help-avaliacao">
      <h3>Gráfico 2 · Avaliação</h3>
      <p>A nota não é de um jornalista nem do GDELT. Um modelo treinado só para isso, o <a href="https://huggingface.co/drifting-walter/kikori" target="_blank" rel="noopener">kikori</a>, lê cada texto sobre a pessoa e marca se fala contra (−10) ou a favor (+10). Até −2,5 conta como contra; de +2,5 para cima, a favor. Vale para todas as fontes. Nunca compare a nota de uma pessoa com a de outra: o nome puxa a nota.</p>
      <p><b>A régua</b> põe cada veículo na sua média; a linha vertical é a média da pessoa. Só entram veículos com 3 ou mais textos.</p>
      <p>No gráfico 1, o modo <b>Avaliação</b> usa a mesma régua com palavras: posição é a média dos textos com a palavra; a cor é a mesma máscara do mapa e da lista. É a mesma nota, não outra medida.</p>
    </div>
    <div id="help-comparar">
      <h3>Gráfico 3 · Régua</h3>
      <p>A posição diz de quem a palavra é. O tamanho é documentos dos dois, somados. No meio, a palavra é dividida. Clique abre os textos das duas pessoas.</p>
      <p>As que não couberam sem cobrir outra ficam numa lista abaixo, e clicam igual. O nome de uma das duas pessoas não entra na régua dela; quantas saíram aparece embaixo.</p>
      <p>Uma palavra sublinhada em âmbar é uma ponte: pelos textos das duas pessoas, ela liga um vocabulário ao outro. A mais atravessada vale 1 e ganham sublinhado as que passam de 0,5. A ponte não muda a posição.</p>
    </div>
    <div id="help-em-alta">
      <h3>Gráfico 4 · Em alta</h3>
      <p>A régua traz as 40 palavras mais presentes na semana. Cada uma fica onde a sua fatia mudou: a fatia é quantos textos sobre a pessoa trazem a palavra, dividido por todas as palavras escritas sobre ela naquela janela. Ao centro, a mesma fatia de antes; à direita, fatia maior; à esquerda, menor.</p>
      <p>Embaixo, as que subiram fora da régua: palavras com poucos textos na semana, fora das 40 mais presentes, mas com lift acima de 1, da maior subida para a menor (até 12, e a lista diz quantas ficaram de fora). Os dois números absolutos, textos nos últimos 7 dias e nos 14 dias antes, ficam escritos embaixo da régua. Clique abre os textos da última semana com aquela palavra.</p>
    </div>
    <div id="help-semana">
      <h3>Gráfico 5 · A semana</h3>
      <p>Cada coluna é um dia, do calendário de Brasília, do mais antigo à esquerda ao de hoje à direita. O tamanho da palavra é quantos documentos daquele dia a têm; a posição é só o dia, não mede nada dentro da coluna. Uma palavra que aparece em vários dias repete em cada coluna, sem linha ligando uma à outra.</p>
      <p>Uma expressão de várias palavras quebra em linhas, nos espaços ou depois de um hífen, para caber na coluna. Uma palavra só não quebra na figura: se fica mais larga que a coluna no tamanho que lhe cabe, vai para a lista "não couberam" embaixo da coluna, com seu número de documentos ao lado, onde pode ser partida com hífen. Ela não encolhe para caber: o tamanho seguiria mentindo. A lista também recebe o que passa da altura da coluna num dia com mais palavras do que ela comporta.</p>
      <p>O número junto do rótulo do dia é quantos documentos citam a pessoa naquele dia, mesmo num dia sem nenhuma palavra sobrevivendo ao corte. Clique numa palavra abre os textos daquele dia com aquela palavra.</p>
      <p>O gráfico 1 tem seu próprio calendário em miniatura: ao focar uma palavra, um pequeno gráfico de barras mostra os últimos 7 dias <b>corridos</b>, não dias de calendário como aqui, e independente do período escolhido na frase do gráfico 1.</p>
    </div>
    <div id="help-lentes">
      <h3>Gráfico 6 · Uma pessoa, duas lentes</h3>
      <p>Uma lente é um recorte do mesmo corpus: um veículo, um viés (esquerda, centro, direita) ou uma fonte. A régua compara as duas lentes escolhidas para a mesma pessoa, do mesmo jeito que o gráfico 3 compara duas pessoas: a posição diz de qual lente a palavra é mais, o tamanho é documentos das duas lentes somados. Clique abre os textos das duas lentes.</p>
      <p>Quando as duas lentes escolhidas são exatamente a mesma, aparece o aviso "Os dois lados mostram o mesmo recorte". O nome da pessoa não entra na régua; quantas palavras saíram por isso aparece embaixo, nas duas lentes juntas, já que é a mesma pessoa nos dois lados.</p>
      <p>Uma lente inválida ou vazia volta para "Tudo", o corpus inteiro daquele lado, sem erro.</p>
      <p>O sublinhado âmbar é o mesmo do gráfico 3, com as duas lentes no lugar das duas pessoas: a palavra que as duas lentes precisam para falar da pessoa.</p>
    </div>
    <div id="help-atencao">
      <h3>Gráfico 7 · Atenção e menções</h3>
      <p>Uma linha traz quantas pessoas visitaram a página da Wikipédia da pessoa, dia a dia: curiosidade, não opinião. A outra traz quantos textos a citam naquele mesmo dia. As duas nunca são comparadas como um número contra o outro: vivem em ordens de grandeza diferentes, cada uma na sua própria escala.</p>
      <p>Uma frase compara os dois picos: quantos dias a imprensa veio antes da curiosidade, ou quantos dias o público buscou antes de a imprensa escrever. Sem pico em nenhuma das duas (pessoa sem página rastreada, ou janela vazia), não há frase, só uma nota. Clique em qualquer das duas linhas abre os textos de menções do dia; pageviews não têm texto próprio para abrir.</p>
    </div>
    <div id="help-agenda">
      <h3>Gráfico 8 · Agenda por veículo</h3>
      <p>Uma linha por veículo, entre os 30 com mais documentos rastreados no recorte; uma coluna por pessoa acompanhada. Cada célula é a fatia dos documentos daquele veículo que citam aquela pessoa, entre todos os documentos daquele veículo que citam alguém acompanhado. A fatia é do veículo, não da pessoa: um veículo que só fala de uma pessoa mostra 100% para ela, mesmo escrevendo pouco no total.</p>
      <p>A soma de uma linha pode passar de 100%: um documento que cita duas pessoas acompanhadas conta para as duas, uma vez cada. Um veículo com poucos documentos rastreados nem entra na tabela. Clique numa célula abre os documentos daquela pessoa naquele veículo.</p>
    </div>
    <div id="help-junto">
      <h3>Gráfico 9 · Quem aparece junto</h3>
      <p>Cada célula conta os textos que citam as duas pessoas ao mesmo tempo, na mesma janela. Aparecer junto não é concordar: a célula não diz se as duas foram citadas a favor, contra ou uma da outra, só que o mesmo texto falou das duas.</p>
      <p>O mínimo escolhido na frase esconde os pares com poucos textos em comum: um par abaixo dele fica em branco na matriz, não desaparece dela. Clicar numa célula preenchida abre os textos daquele par; clique de novo, ou fora da matriz, fecha.</p>
    </div>
    <div id="help-persistencia">
      <h3>Gráfico 10 · Persistência</h3>
      <p>Cada linha é uma palavra; cada célula, uma semana de segunda a domingo, no calendário de Brasília, da mais antiga à esquerda à atual à direita. A célula mostra quantos documentos sobre a pessoa trazem a palavra naquela semana. A palavra só entra na semana se estiver entre as 50 mais fortes dela, com pelo menos 2 documentos.</p>
      <p>Uma célula vazia não é zero: quer dizer que a palavra ficou fora das 50 mais fortes daquela semana. Antes da primeira semana gravada a célula diz &ldquo;sem dados&rdquo;. A série começa em 9 de setembro de 2026 e cresce uma semana por vez; com menos de quatro semanas, a figura avisa.</p>
      <p>A sequência conta as semanas seguidas com a palavra, até agora. A semana em curso ainda está incompleta e não interrompe a conta se estiver vazia. A meia-vida é o número de semanas do pico até a primeira semana completa em que a palavra caiu à metade ou menos; &ldquo;sem queda&rdquo; quer dizer que isso ainda não aconteceu.</p>
      <p>Clicar numa célula abre os textos daquela semana com a palavra. Semanas mais antigas que o período de documentos guardado mostram o número, mas não abrem textos.</p>
    </div>
    <p>Tom só existe nos textos do GDELT. O site não inventa tom para o resto.</p>
    <p class="help-foot"><a href="/como-ler" data-leave>Página do guia</a>, se quiser mandar o link.</p>
  </div>
</dialog>
