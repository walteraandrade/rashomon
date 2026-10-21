<svelte:head>
<title>rashomon · como ler</title>
</svelte:head>

<header class="top"><a class="brand" href="/"><img src="/rashomon-mark.svg" alt="" width="28" height="28">rashomon<span>.</span></a><nav><a class="help-link" href="/">atlas</a><a class="help-link" href="/sobre">sobre</a></nav></header>
<main class="reading">
  <header class="masthead">
    <p class="eyebrow">Rashomon · guia</p>
    <h1 id="comoLerTitle">Como ler o rashomon</h1>
    <p class="lede">Nove gráficos sobre os textos que citam uma pessoa. A chave embaixo de cada título é o gráfico. Esta página é a mesma chave, para mandar o link.</p>
  </header>
  <section class="chapter chapter-page" id="como-ler" aria-labelledby="comoLerTitle">
    <p class="chapter-intro">Tudo vale só para o recorte da frase: pessoa, período e fonte.</p>
    <nav class="chapter-nav" aria-label="Seções"><a href="#analise">Uma análise</a><a href="#atlas">Atlas</a><a href="#avaliacao">Avaliação</a><a href="#pmi">PMI</a><a href="#comparar">Comparar</a><a href="#lentes">Lentes</a><a href="#em-alta">Em alta</a><a href="#semana">A semana</a><a href="#atencao">Atenção</a><a href="#agenda">Agenda</a><a href="#junto">Quem aparece junto</a><a href="#persistencia">Persistência</a></nav>
    <div class="chapter-grid">
      <div id="analise">
        <h2>Como fazer uma análise</h2>
        <ol>
          <li><b>Escolha uma pessoa</b>, o período e a fonte. Isso é o recorte.</li>
          <li><b>Olhe a lista:</b> as barras mais longas são as palavras que mais pesam na medida da frase. Clique numa para ler os textos. O cartão fica aberto na próxima escolha e arrasta pelo topo.</li>
          <li><b>Clique na primeira linha da lista</b> para os textos da pessoa, sem palavra no meio. Na Dispersão, o mesmo vale para a linha acima do gráfico.</li>
          <li><b>No gráfico 2</b>, compare veículos da mesma pessoa. <b>No 3</b>, de quem a palavra é, ou leia a mesma pessoa por dois recortes ao mesmo tempo. <b>No 7</b>, veja a fatia de cada veículo por pessoa.</li>
        </ol>
      </div>
      <div id="atlas">
        <h2>Gráfico 1 · Atlas de palavras</h2>
        <p>A lista é a vista padrão: uma linha por palavra, na ordem da medida da frase, com a barra no comprimento dessa medida. A primeira linha da lista abre os textos da pessoa.</p>
        <h3>Frequência</h3>
        <p>Em quantos textos sobre a pessoa a palavra aparece. Frequência diz o que se fala muito.</p>
        <h3>Alcance</h3>
        <p>Com “alcance” no lugar de frequência, a barra é a soma dos reposts dos posts do Bluesky que a trazem, e não quantos textos a citam. É contado quando o rashomon coletou o post: um post que continuou circulando depois fica subcontado. Só documentos do Bluesky têm alcance; os das outras fontes não têm e contam como zero.</p>
        <h3>Dispersão</h3>
        <p>O eixo horizontal é documentos, em escala log: cada passo multiplica a contagem. O eixo vertical é o PMI bruto. O PMI pode ser negativo: abaixo da linha “0 = acaso” a palavra aparece menos com esta pessoa do que o acaso daria. Todos os pontos têm o mesmo tamanho.</p>
        <p>Clicar num ponto realça as palavras ligadas a ele, as que aparecem nos mesmos textos. Uma palavra sem rótulo não coube sem tapar outra; ela não sumiu. O ponto continua clicável, e Tab e Enter também o escolhem.</p>
        <h3>Tom</h3>
        <p>Só existe nos textos que vêm do GDELT. As outras fontes não têm tom, e o site não inventa um.</p>
        <h3>Cor (o ponto da lista e do gráfico)</h3>
        <p><b>Colorir por avaliação</b> compara a nota média dos textos com a palavra com a média da pessoa no recorte, e não com o zero. Vermelho: mais hostil que o normal para essa pessoa. Verde: mais favorável. Cinza: igual, ou menos de 3 textos avaliados.</p>
        <h3>Expressões</h3>
        <p>Uma expressão é várias palavras como um termo só (“primeiro turno”, “Alexandre de Moraes”). Ela substitui as palavras que cobre. A contagem de uma palavra passa a ser: textos em que ela aparece pelo menos uma vez fora de qualquer expressão.</p>
        <h3>Organizações</h3>
        <p>Textos vindos do GDELT também trazem organizações citadas na matéria (ministérios, partidos, empresas): um quarto tipo de termo, com a tag org na lista. Vem só do GDELT e nunca é inventado para as outras fontes.</p>
      </div>
      <div id="avaliacao">
        <h2>Gráfico 2 · Avaliação por veículo</h2>
        <p>A nota não é de um jornalista nem do GDELT. Um modelo treinado só para isso, o <a href="https://huggingface.co/drifting-walter/kikori" target="_blank" rel="noopener">kikori</a>, lê cada texto sobre a pessoa e marca se fala contra (−10) ou a favor (+10). Até −2,5 conta como contra; de +2,5 para cima, a favor. Vale para todas as fontes, ao contrário do tom.</p>
        <p>O nome da pessoa puxa a nota. Por isso, compare veículos falando da mesma pessoa; nunca compare a nota de uma pessoa com a de outra.</p>
        <p><b>O gráfico</b> mostra uma linha por veículo, os 20 com mais textos avaliados, e só entram veículos com 3 ou mais textos avaliados. Cada ponto fica na nota média do veículo, de −5 a +5; uma média além disso é desenhada na borda, com uma seta, e o número continua o real. O tamanho do ponto é quantos textos; a linha vertical tracejada é a média da pessoa.</p>
        <p>O modo <b>Avaliação</b> do atlas usa a mesma nota do kikori, mas com palavras: cada palavra fica na média das notas dos textos em que aparece, e a cor é a mesma máscara da lista e da dispersão, a distância até a média desta pessoa. Não é uma segunda medida, é a mesma nota do kikori vista de outro ângulo.</p>
        <p>A lista de veículos também os agrupa por vocabulário parecido. Vocabulário parecido não é a mesma coisa que linha editorial: dois veículos podem usar palavras semelhantes por motivos que nada têm a ver com posição política. E o número de cada grupo não significa nada por si só, nem pode ser comparado entre uma reconstrução e outra do site: ele só serve para juntar veículos naquela leitura.</p>
      </div>
      <div id="pmi">
        <h2>PMI</h2>
        <p>Frequência conta. PMI compara. Ele pergunta: essa palavra aparece com essa pessoa mais do que apareceria por acaso?</p>
        <p>“presidente” aparece com todo político: frequência alta, PMI baixo. Uma palavra quase só desta pessoa tem PMI alto.</p>
        <dl class="pmi-scale">
          <div><dt>0</dt><dd>igual ao acaso</dd></div>
          <div><dt>1</dt><dd>o dobro</dd></div>
          <div><dt>2</dt><dd>quatro vezes</dd></div>
          <div><dt>3</dt><dd>oito vezes</dd></div>
        </dl>
        <p>Cada +1 dobra. <b>PMI ponderado</b> segura a palavra rara: a barra da lista usa PMI × ln(1 + documentos).</p>
      </div>
      <div id="comparar">
        <h2>Gráfico 3 · Duas pessoas ou dois recortes</h2>
        <p>Cada linha é uma palavra, com uma barra para cada pessoa. A barra é a fatia dos documentos daquela pessoa que trazem a palavra, na mesma escala para as duas. Clique abre os textos das duas pessoas.</p>
        <p>As linhas vêm em três grupos: só da primeira pessoa, dos dois e só da segunda. “Só” quer dizer que a barra desta pessoa existe e a da outra não. “Documentos” ou “PMI ponderado” na frase mudam só quais palavras ganham uma linha, nunca o comprimento de uma barra. Cada pessoa entra com as suas palavras mais fortes, até o número escolhido, então a figura pode ter até o dobro de linhas.</p>
        <p>Uma barra que falta pode querer dizer que a palavra ficou abaixo do que a construção pré-computada deste recorte guardou, não que a contagem é zero. Esse lado conta como zero também no comprimento da barra e na escolha das palavras que concorrem a ponte. Por isso a palavra pode cair no grupo “só” de uma pessoa mesmo quando a outra também a usou.</p>
        <p>O nome de uma das duas pessoas não é desenhado; quantas palavras saíram aparece embaixo.</p>
        <h3 id="ponte">Ponte</h3>
        <p>Uma marca âmbar antes da palavra é uma ponte: pelos documentos das duas pessoas, ela liga palavras de um vocabulário às do outro. A conta junta as palavras que aparecem juntas no mesmo texto, dos dois lados, e mede por quantos caminhos mais curtos entre duas palavras quaisquer ela passa (centralidade de intermediação). A mais atravessada vale 1; ganham marca as que passam de 0,5. A ponte não muda nem a escolha nem a ordem das linhas: uma palavra pode ter barra só de um lado e ainda assim ligar os dois.</p>
        <div id="lentes">
          <h3>Uma pessoa, duas lentes</h3>
          <p>Na frase do gráfico, “uma pessoa, dois recortes” no lugar de “duas pessoas” lê a mesma pessoa por duas lentes ao mesmo tempo. Uma lente é um recorte do mesmo corpus: um veículo, um viés (esquerda, centro, direita) ou uma fonte. Começa com Bluesky de um lado e Google News do outro.</p>
          <p><b>Barras e grupos.</b> Funcionam como na comparação entre duas pessoas, com as lentes no lugar delas: cada barra é a fatia dos textos daquela lente que trazem a palavra, na mesma escala para as duas, e os grupos são os da tela: “só” com o nome de uma lente, “dos dois” e “só” com o nome da outra. Neste modo as palavras são sempre escolhidas por PMI ponderado, sem a escolha entre “Documentos” e “PMI ponderado”, e a barra continua sendo a fatia dos textos. Clique abre os textos das duas lentes, cada uma com o seu veículo, viés ou fonte.</p>
          <p><b>Barra que falta.</b> Uma barra ausente pode querer dizer que a palavra ficou abaixo do que a construção pré-computada deste recorte guardou, não que a contagem é zero. Esse lado conta como zero também no comprimento da barra e na escolha das palavras que concorrem a ponte.</p>
          <p><b>Mesmo recorte.</b> Quando as duas lentes são exatamente a mesma, aparece o aviso “Os dois lados mostram o mesmo recorte”. Não há detecção de recortes equivalentes com nomes diferentes: só a mesma lente, escrita do mesmo jeito, conta.</p>
          <p><b>Poucos textos.</b> Uma lente com menos de 50 textos da pessoa ganha uma nota embaixo dizendo quantos são: leia com cuidado, porque poucas palavras dominam a fatia.</p>
          <p><b>Nome próprio.</b> O próprio nome da pessoa fica de fora, nas duas lentes, porque é a mesma pessoa dos dois lados. Em parte dos recortes quantas palavras saíram por isso aparece embaixo; nos outros o nome já fica fora da construção e a contagem não aparece.</p>
          <p><b>Lente inválida.</b> Uma lente vazia, malformada ou desconhecida volta para “Tudo”, o corpus inteiro daquele lado, sem erro.</p>
          <p><b>Ponte.</b> É a marca âmbar da comparação entre duas pessoas, com as duas lentes no lugar delas. A conta está em <a href="#ponte">Ponte</a>.</p>
        </div>
      </div>
      <div id="em-alta">
        <h2>Gráfico 4 · Em alta</h2>
        <p>O gráfico traz as 20 palavras mais presentes nos últimos 7 dias de textos sobre a pessoa, uma linha por palavra. Não as que mais subiram: um grupo escolhido por subir só diria o que sobe.</p>
        <p>Cada palavra tem duas bolinhas na mesma escala: a de antes (os 14 dias anteriores) e a de agora (os 7 últimos dias). A escala é ocorrências a cada mil palavras escritas sobre a pessoa: quantos textos trazem a palavra, dividido pelo total de pares texto-palavra da janela, vezes mil. Uma palavra conta uma vez por texto. Dividir pelo total da janela, e não por textos, cancela o que muda quando um veículo passa a mandar o texto inteiro em vez do título: cada documento traz muito mais palavras, e toda palavra "sobe" junto sem que nada tenha mudado sobre a pessoa.</p>
        <p>A coluna da direita é a razão agora ÷ antes, com uma casa decimal: ×3,2 quer dizer que a palavra ocupa uma fatia 3,2 vezes maior que a de antes. "nova" quer dizer que a palavra não apareceu nos 14 dias antes, e só a bolinha de agora é desenhada. As linhas vão da maior razão para a menor, e essa razão ganha um texto de brinde (+1) do lado do antes, o mesmo alisamento que o lift da API usa, para uma palavra nova não ir ao infinito. Quando faltam os totais de palavras, a escala passa a ser textos com a palavra a cada cem textos sobre a pessoa.</p>
        <p>Embaixo, as que subiram fora do gráfico: palavras com poucos textos na semana, fora das mais presentes, mas com lift acima de 1, da maior subida para a menor (até 12, e a lista diz quantas ficaram de fora). Os dois números absolutos, textos nos últimos 7 dias e nos 14 dias antes, ficam escritos embaixo do gráfico. Clique abre os textos da última semana com aquela palavra.</p>
      </div>
      <div id="semana">
        <h2>Gráfico 5 · A semana</h2>
        <p>Uma tabela: cada linha é uma palavra, cada coluna um dia do calendário, na hora de Brasília, o mais antigo à esquerda e hoje à direita. Não há cor de avaliação nem comparação entre pessoas aqui.</p>
        <h3>Linhas</h3>
        <p>As linhas seguem o total da palavra na semana, das que mais apareceram às que menos; a mesma palavra como hashtag é outra linha. Uma palavra que ficou a semana toda se lê numa linha só.</p>
        <h3>A célula</h3>
        <p>O número é quantos documentos daquele dia têm a palavra, e a tinta é o mesmo número: a mais clara é a maior célula da semana, numa escala só para a figura inteira.</p>
        <h3>A célula vazia</h3>
        <p>Tracejada, a célula vazia não é zero: a palavra ficou fora das N mais citadas daquele dia (N é o número que a frase pede). Num dia com menos de N palavras, a célula vazia quer dizer que a palavra não apareceu.</p>
        <h3>O número do dia</h3>
        <p>Junto do rótulo de cada dia, quantos documentos citam a pessoa naquele dia, mesmo quando nenhuma palavra sobrevive ao corte de nomes próprios. Um dia sem documentos mostra 0 e não some da semana.</p>
        <h3>Clique</h3>
        <p>Abre os textos daquele dia com aquela palavra. Clicar de novo na mesma célula, num espaço vazio da tabela ou apertar Esc fecha. Em telas estreitas a tabela rola para o lado e a coluna das palavras fica fixa.</p>
        <p>O atlas tem seu próprio calendário em miniatura: ao focar uma palavra, um pequeno gráfico de barras mostra os últimos 7 dias <b>corridos</b>, não dias de calendário como aqui, e independente do período escolhido na frase do atlas.</p>
      </div>
      <div id="atencao">
        <h2>Gráfico 6 · Atenção e menções</h2>
        <p>Uma linha traz quantas pessoas visitaram a página da Wikipédia da pessoa, dia a dia: curiosidade, não opinião. Ninguém escreve nada para gerar uma visita; a página só é procurada. A outra linha traz quantos textos a citam a cada dia, documentos por dia contados em janelas corridas de 24 horas, não o dia-calendário da semana.</p>
        <h3>Duas escalas, nunca uma</h3>
        <p>As duas linhas nunca são comparadas como um número contra o outro: pageviews e documentos vivem em ordens de grandeza diferentes, e cada linha tem seu próprio tamanho, na sua própria escala, independente da outra. O que se compara é a posição: o dia em que cada linha atingiu seu pico.</p>
        <h3>Quem veio primeiro</h3>
        <p>Uma frase compara os dois picos: quantos dias a imprensa veio antes da curiosidade, ou quantos dias o público buscou antes de a imprensa escrever, ou se os dois picos caíram no mesmo dia. Quando uma das linhas não tem pico (a pessoa não tem página de Wikipédia rastreada, ou a janela está vazia), não há frase, só uma nota. Uma pessoa sem dado de pageviews não ganha barras de pageviews: a linha mostra só uma nota, sem barras, e as menções seguem como estão.</p>
        <h3>Clique</h3>
        <p>Abre os textos de menções daquele dia, em qualquer das duas linhas. Pageviews não têm texto próprio para abrir.</p>
      </div>
      <div id="agenda">
        <h2>Gráfico 7 · Agenda por veículo</h2>
        <p>Uma tabela: uma linha por veículo, entre os 30 com mais documentos rastreados no recorte; uma coluna por pessoa acompanhada. Diferente dos outros gráficos, ele não olha uma pessoa por vez: compara todas de uma vez, veículo por veículo.</p>
        <h3>A fatia</h3>
        <p>Cada célula é a fatia dos documentos daquele veículo que citam aquela pessoa, entre todos os documentos daquele veículo que citam alguém acompanhado. A fatia é do veículo, não da pessoa: um veículo pequeno que só fala de uma pessoa mostra 100% para ela, mesmo escrevendo pouco no total. O número da célula é a fatia absoluta, mas a tinta é relativa à maior fatia da grade mostrada: a célula de maior fatia tem a tinta mais clara, e a mais fraca fica perto do cinza. A mesma porcentagem pode ler mais clara ou mais fraca em outro recorte. A coluna dos veículos fica à vista quando a grade rola para o lado.</p>
        <h3>Por que passa de 100%</h3>
        <p>Um documento que cita duas pessoas acompanhadas conta uma vez para cada uma. Por isso a soma de uma linha pode passar de 100%; a tabela mede quem o veículo cobre, não divide o veículo em partes.</p>
        <h3>Veículo de fora</h3>
        <p>Um veículo com poucos documentos rastreados na janela nem entra na tabela. Um documento sem veículo identificado nunca conta para nenhuma linha.</p>
        <h3>Clique</h3>
        <p>Abre os documentos daquela pessoa naquele veículo.</p>
      </div>
      <div id="junto">
        <h2>Gráfico 8 · Quem aparece junto</h2>
        <p>A lista é a vista de partida. Cada linha é um par de pessoas rastreadas: o nome, uma barra e quantos textos citam as duas ao mesmo tempo, na mesma janela de dias.</p>
        <h3>Uma pessoa ou todas</h3>
        <p>Com uma pessoa escolhida na frase, a lista traz quem apareceu junto com ela, uma linha por parceiro. Com &ldquo;todas as pessoas&rdquo;, traz os 15 pares com mais textos em comum.</p>
        <h3>A barra</h3>
        <p>A barra mais longa é o maior número daquela lista; as outras seguem em proporção. Não é uma fatia do total de textos, e a escala muda quando a lista muda.</p>
        <h3>Aparecer junto não é concordar</h3>
        <p>A linha só diz que o mesmo texto falou das duas pessoas. Não diz se foi a favor, contra, ou uma da outra: exposição, não avaliação. É por isso que a barra usa só uma tonalidade de tinta, nunca o par de cores da avaliação por veículo.</p>
        <h3>Mínimo</h3>
        <p>O mínimo escolhido na frase esconde os pares com menos textos em comum que ele. Com o mínimo em 1 aparecem todos os pares.</p>
        <h3>Clique</h3>
        <p>Abre os textos daquele par, os mesmos textos que citam as duas pessoas juntas. Clique de novo na mesma linha, ou fora da lista, fecha.</p>
        <h3>A matriz</h3>
        <p>Em telas de 900px ou mais, o botão &ldquo;ver a grade inteira&rdquo; troca a lista pela matriz: todas as pessoas rastreadas nas duas margens, uma célula por par, com a mesma cor de tinta. A matriz mostra todos os pares, seja qual for a pessoa escolhida. Contagens grandes que não cabem na célula aparecem em milhares, arredondadas (&ldquo;10k&rdquo; é 10 mil), e o número exato aparece ao passar o mouse. &ldquo;Ver a lista&rdquo; volta, e o clique funciona igual.</p>
      </div>
      <div id="persistencia">
        <h2>Gráfico 9 · Persistência</h2>
        <p>Uma linha por palavra, uma célula por semana, de segunda a domingo na hora de Brasília: a mais antiga à esquerda, a atual à direita. A figura responde a uma pergunta que os outros não respondem: a palavra ficou, ou foi só um pico?</p>
        <h3>Célula</h3>
        <p>Quantos documentos sobre a pessoa trazem a palavra naquela semana; quanto mais documentos, mais tinta. A escala é uma só para a figura toda, então uma palavra com poucos documentos continua visível, só mais clara. Tudo aqui é tinta, sem cor de avaliação nem de comparação.</p>
        <h3>Célula vazia não é zero</h3>
        <p>Cada semana guarda só as 50 palavras mais fortes da pessoa, pela mesma conta do PMI ponderado (PMI × ln(1 + documentos)), com pelo menos 2 documentos. Uma célula vazia diz que a palavra ficou fora dessas 50, não que não apareceu. Antes da primeira semana gravada a célula diz &ldquo;sem dados&rdquo;. A palavra do nome da própria pessoa não entra.</p>
        <p>Sequência e meia-vida são duas colunas na borda direita da tabela; em telas largas ficam à vista quando as semanas rolam para o lado, e em telas estreitas rolam junto com elas, no fim; as duas são contadas em semanas.</p>
        <h3>Sequência</h3>
        <p>Semanas seguidas com a palavra, contadas da atual para trás. A semana em curso ainda está incompleta: se estiver vazia, a contagem parte da anterior. É a leitura de quem ficou.</p>
        <h3>Meia-vida</h3>
        <p>Só semanas completas. Acha-se o pico da palavra (o mais recente, se houver empate) e conta-se quantas semanas passam até a primeira em que ela caiu à metade do pico ou menos; uma semana vazia conta como queda. &ldquo;Sem queda&rdquo; quer dizer que isso ainda não aconteceu, inclusive quando o pico é a última semana completa.</p>
        <h3>Série curta</h3>
        <p>A série começa em 9 de setembro de 2026 e cresce uma semana por vez; nada é reconstruído para trás. Enquanto houver menos de quatro semanas, uma nota diz quantas existem. As semanas guardadas continuam como foram gravadas, com o vocabulário do seu tempo.</p>
        <h3>Clique</h3>
        <p>Abre os textos da pessoa naquela semana com aquela palavra. Semanas mais antigas que o período de documentos guardado mostram o número, mas não abrem textos. Clique de novo na mesma célula, ou fora da tabela, fecha.</p>
      </div>
    </div>
    <p class="chapter-foot"><span>Tom por termo continua na API, sem página própria.</span><span>Sem dados fictícios em produção.</span></p>
  </section>
</main>
