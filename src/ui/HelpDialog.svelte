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
        <li>Leia a lista, das barras mais longas para as mais curtas. Clique numa palavra para ver os textos; a primeira linha abre os textos da pessoa.</li>
        <li>No gráfico 2, compare veículos da mesma pessoa. No 3, de quem a palavra é, ou como uma pessoa muda de um recorte para outro. No 4, o que ganhou ou perdeu espaço esta semana. Em A semana, em quais dias cada palavra apareceu. No 7, veja a fatia de cada veículo por pessoa.</li>
      </ol>
    </div>
    <div id="help-atlas">
      <h3>Gráfico 1 · Atlas</h3>
      <dl class="figure-key">
        <div><dt>Barra</dt><dd>frequência, PMI ponderado ou alcance: a medida escolhida na frase</dd></div>
        <div><dt>Cor</dt><dd>avaliação contra a média desta pessoa</dd></div>
        <div><dt>Organização</dt><dd>tag org: organização citada no texto, só no GDELT</dd></div>
        <div><dt>Clique</dt><dd>textos da palavra; na primeira linha, textos da pessoa</dd></div>
      </dl>
      <p>A lista é a vista padrão: uma linha por palavra, na ordem da medida da frase, com a barra no comprimento dessa medida. A primeira linha da lista abre os textos da pessoa.</p>
      <p>Alcance é a soma dos reposts dos posts do Bluesky que trazem a palavra. É contado quando o rashomon coletou o post, então um post que continuou circulando depois fica subcontado. Só documentos do Bluesky têm alcance; os das outras fontes não têm e contam como zero.</p>
      <p>A <b>Dispersão</b> põe as mesmas palavras como pontos de tamanho igual. O eixo horizontal é documentos, em escala log: cada passo multiplica a contagem. O eixo vertical é o PMI bruto. O PMI pode ser negativo: abaixo da linha “0 = acaso” a palavra aparece menos com esta pessoa do que o acaso daria. Clicar num ponto realça as palavras ligadas a ele, as que aparecem nos mesmos textos.</p>
      <p>Na Dispersão, uma palavra sem rótulo não coube sem tapar outra; ela não sumiu. O ponto continua clicável, e Tab e Enter também o escolhem.</p>
      <p>Cinza: igual à média, ou menos de 3 textos avaliados.</p>
      <p>No modo <b>Avaliação</b> a posição passa a ser a média das notas dos textos com a palavra; a cor continua a mesma máscara.</p>
      <p>Uma expressão é várias palavras como um termo só. Ela substitui as palavras que cobre; a contagem de uma palavra passa a ser os textos em que ela aparece fora de qualquer expressão.</p>
      <p>Textos vindos do GDELT também trazem organizações citadas na matéria (ministérios, partidos, empresas): um quarto tipo de termo, com a tag org. Vem só do GDELT e nunca é inventado para as outras fontes.</p>
      <p>Clique numa palavra abre os textos. A primeira linha da lista, e o alto da Dispersão, abre os da pessoa. O cartão fica aberto na próxima escolha e arrasta pelo topo.</p>
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
      <p>No gráfico 1, o modo <b>Avaliação</b> usa a mesma régua com palavras: posição é a média dos textos com a palavra; a cor é a mesma máscara da lista e da dispersão. É a mesma nota, não outra medida.</p>
    </div>
    <div id="help-comparar">
      <h3>Gráfico 3 · Duas pessoas ou dois recortes</h3>
      <p>Cada linha é uma palavra, com uma barra para cada pessoa. A barra é a fatia dos documentos daquela pessoa que trazem a palavra, na mesma escala para as duas. Clique abre os textos das duas pessoas.</p>
      <p>As linhas vêm em três grupos: só da primeira pessoa, dos dois e só da segunda. “Só” quer dizer que a barra desta pessoa existe e a da outra não. “Documentos” ou “PMI ponderado” na frase mudam só quais palavras ganham uma linha, nunca o comprimento de uma barra. Cada pessoa entra com as suas palavras mais fortes, até o número escolhido, então a figura pode ter até o dobro de linhas.</p>
      <p>Uma barra que falta pode querer dizer que a palavra ficou abaixo do que a construção pré-computada deste recorte guardou, não que a contagem é zero. O nome de uma das duas pessoas não é desenhado; quantas palavras saíram aparece embaixo.</p>
      <p>Uma marca âmbar antes da palavra é uma ponte: pelos textos das duas pessoas, ela liga um vocabulário ao outro. A mais atravessada vale 1 e ganham marca as que passam de 0,5. A ponte não muda nem a escolha nem a ordem das linhas.</p>
      <div id="help-lentes">
        <p><b>Uma pessoa, duas lentes.</b> No modo “uma pessoa, dois recortes” da frase, o gráfico lê a mesma pessoa por duas lentes. Uma lente é um recorte do mesmo corpus: um veículo, um viés (esquerda, centro, direita) ou uma fonte. Começa com Bluesky à esquerda e Google News à direita.</p>
        <p><b>Barras e grupos</b> funcionam como na comparação entre duas pessoas, com as lentes no lugar delas: cada barra é a fatia dos textos daquela lente que trazem a palavra, as linhas vêm em três grupos: “só” com o nome de uma lente, “dos dois” e “só” com o nome da outra, e “Documentos” ou “PMI ponderado” não mudam o comprimento de uma barra. Aqui as palavras são escolhidas por PMI. Clique abre os textos das duas lentes.</p>
        <p><b>Mesmo recorte.</b> Se as duas lentes forem exatamente a mesma, aparece o aviso “Os dois lados mostram o mesmo recorte”. Uma lente inválida ou vazia volta para “Tudo”, o corpus inteiro daquele lado, sem erro.</p>
        <p><b>Poucos textos.</b> Uma lente com menos de 50 textos da pessoa ganha uma nota embaixo dizendo quantos são: leia com cuidado, porque poucas palavras dominam a fatia.</p>
        <p><b>Barra que falta.</b> Uma barra ausente pode querer dizer que a palavra ficou abaixo do que a construção pré-computada deste recorte guardou, não que a contagem é zero. O próprio nome da pessoa não entra; quantas palavras saíram por isso aparece embaixo, nas duas lentes juntas.</p>
        <p><b>Ponte.</b> É a ponte da comparação entre duas pessoas, com as duas lentes no lugar delas: a marca âmbar antes da palavra que as duas lentes precisam para falar da pessoa.</p>
      </div>
    </div>
    <div id="help-em-alta">
      <h3>Gráfico 4 · Em alta</h3>
      <p>O gráfico traz as 20 palavras mais presentes nos últimos 7 dias de textos sobre a pessoa, uma linha por palavra. Não as que mais subiram: um grupo escolhido por subir só diria o que sobe.</p>
      <p>Cada palavra tem duas bolinhas na mesma escala: a de antes (os 14 dias anteriores) e a de agora (os 7 últimos dias). A escala é ocorrências a cada mil palavras escritas sobre a pessoa: quantos textos trazem a palavra, dividido pelo total de pares texto-palavra da janela, vezes mil. Uma palavra conta uma vez por texto. Dividir pelo total da janela, e não por textos, cancela o que muda quando um veículo passa a mandar o texto inteiro em vez do título: cada documento traz muito mais palavras, e toda palavra "sobe" junto sem que nada tenha mudado sobre a pessoa.</p>
      <p>A coluna da direita é a razão agora ÷ antes, com uma casa decimal: ×3,2 quer dizer que a palavra ocupa uma fatia 3,2 vezes maior que a de antes. "nova" quer dizer que a palavra não apareceu nos 14 dias antes, e só a bolinha de agora é desenhada. As linhas vão da maior razão para a menor, e essa razão ganha um texto de brinde (+1) do lado do antes, o mesmo alisamento que o lift da API usa, para uma palavra nova não ir ao infinito. Quando faltam os totais de palavras, a escala passa a ser textos com a palavra a cada cem textos sobre a pessoa.</p>
      <p>Embaixo, as que subiram fora do gráfico: palavras com poucos textos na semana, fora das mais presentes, mas com lift acima de 1, da maior subida para a menor (até 12, e a lista diz quantas ficaram de fora). Os dois números absolutos, textos nos últimos 7 dias e nos 14 dias antes, ficam escritos embaixo do gráfico. Clique abre os textos da última semana com aquela palavra.</p>
    </div>
    <div id="help-semana">
      <h3>Gráfico 5 · A semana</h3>
      <p>Uma tabela: cada linha é uma palavra, cada coluna um dia do calendário de Brasília, do mais antigo à esquerda ao de hoje à direita. As linhas seguem o total da palavra na semana, das que mais apareceram às que menos; uma palavra que ficou a semana toda se lê numa linha só.</p>
      <p>O número na célula é quantos documentos daquele dia têm a palavra, e a tinta é o mesmo número: a mais clara é a maior célula da semana. Uma célula vazia, tracejada, não é zero: a palavra ficou fora das N mais citadas daquele dia (N é o que a frase pede). Num dia com menos de N palavras, a célula vazia quer dizer que a palavra não apareceu.</p>
      <p>O número junto do rótulo do dia é quantos documentos citam a pessoa naquele dia, mesmo num dia sem nenhuma palavra sobrevivendo ao corte, que então mostra 0. Clique numa célula abre os textos daquele dia com aquela palavra. Clicar de novo na mesma célula, num espaço vazio da tabela ou apertar Esc fecha. Em telas estreitas a tabela rola para o lado e a coluna das palavras fica fixa.</p>
      <p>O atlas tem seu próprio calendário em miniatura: ao focar uma palavra, um pequeno gráfico de barras mostra os últimos 7 dias <b>corridos</b>, não dias de calendário como aqui, e independente do período escolhido na frase do atlas.</p>
    </div>
    <div id="help-atencao">
      <h3>Gráfico 6 · Atenção e menções</h3>
      <p>Uma linha traz quantas pessoas visitaram a página da Wikipédia da pessoa, dia a dia: curiosidade, não opinião. A outra traz quantos textos a citam naquele mesmo dia. As duas nunca são comparadas como um número contra o outro: vivem em ordens de grandeza diferentes, cada uma na sua própria escala.</p>
      <p>Uma frase compara os dois picos: quantos dias a imprensa veio antes da curiosidade, ou quantos dias o público buscou antes de a imprensa escrever. Sem pico em nenhuma das duas (pessoa sem página rastreada, ou janela vazia), não há frase, só uma nota. Clique em qualquer das duas linhas abre os textos de menções do dia; pageviews não têm texto próprio para abrir.</p>
    </div>
    <div id="help-agenda">
      <h3>Gráfico 7 · Agenda por veículo</h3>
      <p>Uma linha por veículo, entre os 30 com mais documentos rastreados no recorte; uma coluna por pessoa acompanhada. Cada célula é a fatia dos documentos daquele veículo que citam aquela pessoa, entre todos os documentos daquele veículo que citam alguém acompanhado. A fatia é do veículo, não da pessoa: um veículo que só fala de uma pessoa mostra 100% para ela, mesmo escrevendo pouco no total.</p>
      <p>A soma de uma linha pode passar de 100%: um documento que cita duas pessoas acompanhadas conta para as duas, uma vez cada. Um veículo com poucos documentos rastreados nem entra na tabela. Clique numa célula abre os documentos daquela pessoa naquele veículo.</p>
    </div>
    <div id="help-junto">
      <h3>Gráfico 8 · Quem aparece junto</h3>
      <p>Cada célula conta os textos que citam as duas pessoas ao mesmo tempo, na mesma janela. Aparecer junto não é concordar: a célula não diz se as duas foram citadas a favor, contra ou uma da outra, só que o mesmo texto falou das duas.</p>
      <p>O mínimo escolhido na frase esconde os pares com poucos textos em comum: um par abaixo dele fica em branco na matriz, não desaparece dela. Clicar numa célula preenchida abre os textos daquele par; clique de novo, ou fora da matriz, fecha.</p>
    </div>
    <div id="help-persistencia">
      <h3>Gráfico 9 · Persistência</h3>
      <p>Cada linha é uma palavra; cada célula, uma semana de segunda a domingo, no calendário de Brasília, da mais antiga à esquerda à atual à direita. A célula mostra quantos documentos sobre a pessoa trazem a palavra naquela semana. A palavra só entra na semana se estiver entre as 50 mais fortes dela, com pelo menos 2 documentos.</p>
      <p>Uma célula vazia não é zero: quer dizer que a palavra ficou fora das 50 mais fortes daquela semana. Antes da primeira semana gravada a célula diz &ldquo;sem dados&rdquo;. A série começa em 9 de setembro de 2026 e cresce uma semana por vez; com menos de quatro semanas, a figura avisa.</p>
      <p>A sequência conta as semanas seguidas com a palavra, até agora. A semana em curso ainda está incompleta e não interrompe a conta se estiver vazia. A meia-vida é o número de semanas do pico até a primeira semana completa em que a palavra caiu à metade ou menos; &ldquo;sem queda&rdquo; quer dizer que isso ainda não aconteceu.</p>
      <p>Clicar numa célula abre os textos daquela semana com a palavra. Semanas mais antigas que o período de documentos guardado mostram o número, mas não abrem textos.</p>
    </div>
    <p>Tom só existe nos textos do GDELT. O site não inventa tom para o resto.</p>
    <p class="help-foot"><a href="/como-ler" data-leave>Página do guia</a>, se quiser mandar o link.</p>
  </div>
</dialog>
