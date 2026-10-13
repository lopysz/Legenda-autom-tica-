"use strict";

/* =========================================================
   LYRIC STUDIO
   Áudio, legendas sincronizadas, prévia e exportação
   Imagens arrastáveis, redimensionáveis e rotacionáveis
========================================================= */

const $ = id => document.getElementById(id);

const audio = $("audio");
const canvas = $("canvas");
const ctx = canvas.getContext("2d");

/* =========================================================
   ESTADO
========================================================= */

let arquivoURL = null;
let legendas = [];

let audioContext = null;
let sourceNode = null;
let audioDestination = null;
let analyser = null;

let recorder = null;
let chunks = [];
let exportando = false;
let animacao = null;
let audioAnterior = null;

let elementosVisuais = [];
let elementoSelecionado = null;
let proximoIdElemento = 1;
let arrasteElemento = null;

/* =========================================================
   UTILITÁRIOS
========================================================= */

function fmt(segundos) {
  if (!Number.isFinite(segundos) || segundos < 0) {
    segundos = 0;
  }

  const minutos = Math.floor(segundos / 60);
  const segundosRestantes = Math.floor(segundos % 60);

  return (
    String(minutos).padStart(2, "0") +
    ":" +
    String(segundosRestantes).padStart(2, "0")
  );
}

function fmtTempo(segundos) {
  if (!Number.isFinite(segundos) || segundos < 0) {
    segundos = 0;
  }

  const minutos = Math.floor(segundos / 60);
  const segundosRestantes = (segundos % 60).toFixed(3);

  return (
    String(minutos).padStart(2, "0") +
    ":" +
    String(Math.floor(Number(segundosRestantes))).padStart(2, "0") +
    "." +
    segundosRestantes.split(".")[1]
  );
}

function lerTempo(valor) {
  if (typeof valor === "number") {
    return Number.isFinite(valor) ? Math.max(0, valor) : 0;
  }

  const texto = String(valor ?? "").trim();

  if (!texto) return 0;

  if (/^\d+([.,]\d+)?$/.test(texto)) {
    return Math.max(0, Number(texto.replace(",", ".")) || 0);
  }

  const partes = texto.split(":");

  if (partes.length === 2) {
    const minutos = Number(partes[0]);
    const segundos = Number(partes[1].replace(",", "."));

    if (!Number.isFinite(minutos) || !Number.isFinite(segundos)) {
      return 0;
    }

    return Math.max(0, minutos * 60 + segundos);
  }

  if (partes.length === 3) {
    const horas = Number(partes[0]);
    const minutos = Number(partes[1]);
    const segundos = Number(partes[2].replace(",", "."));

    if (
      !Number.isFinite(horas) ||
      !Number.isFinite(minutos) ||
      !Number.isFinite(segundos)
    ) {
      return 0;
    }

    return Math.max(0, horas * 3600 + minutos * 60 + segundos);
  }

  return 0;
}

function mensagem(texto) {
  const elemento = $("mensagem");

  if (elemento) {
    elemento.textContent = texto;
  }
}

function limitar(valor, minimo, maximo) {
  return Math.min(maximo, Math.max(minimo, valor));
}

function duracaoAudio() {
  return Number.isFinite(audio.duration) ? audio.duration : 0;
}

/* =========================================================
   ÁUDIO
========================================================= */

function carregarAudio(arquivo) {
  if (!arquivo) return;

  if (arquivoURL) {
    URL.revokeObjectURL(arquivoURL);
  }

  arquivoURL = URL.createObjectURL(arquivo);

  audio.pause();
  audio.src = arquivoURL;
  audio.load();

  $("nomeAudio").textContent = arquivo.name;
  $("playPause").textContent = "▶ Reproduzir";

  mensagem("Áudio carregado. Agora você pode criar as legendas.");
}

audio.addEventListener("loadedmetadata", () => {
  $("duracao").textContent = fmt(duracaoAudio());
  $("tempoAtual").textContent = fmt(audio.currentTime);
  $("seek").value = 0;

  recalcularFins();
  desenharLista();
});

audio.addEventListener("timeupdate", () => {
  $("tempoAtual").textContent = fmt(audio.currentTime);

  if (duracaoAudio() > 0) {
    $("seek").value =
      (audio.currentTime / duracaoAudio()) * 100;
  }

  atualizarLinhasAtivas();
});

audio.addEventListener("play", () => {
  $("playPause").textContent = "⏸ Pausar";
});

audio.addEventListener("pause", () => {
  $("playPause").textContent = "▶ Reproduzir";
});

audio.addEventListener("ended", () => {
  $("playPause").textContent = "▶ Reproduzir";
});

$("arquivoAudio").addEventListener("change", evento => {
  const arquivo = evento.target.files?.[0];

  if (arquivo) {
    carregarAudio(arquivo);
  }

  evento.target.value = "";
});

$("playPause").addEventListener("click", async () => {
  if (!audio.src) {
    mensagem("Importe uma música antes de reproduzir.");
    return;
  }

  try {
    if (audio.paused) {
      await audio.play();
    } else {
      audio.pause();
    }
  } catch (erro) {
    console.error(erro);
    mensagem("Não foi possível reproduzir o áudio.");
  }
});

$("voltar").addEventListener("click", () => {
  if (!audio.src) return;

  audio.currentTime = Math.max(0, audio.currentTime - 5);
});

$("avancar").addEventListener("click", () => {
  if (!audio.src) return;

  const limite = duracaoAudio() || Infinity;

  audio.currentTime = Math.min(
    limite,
    audio.currentTime + 5
  );
});

$("seek").addEventListener("input", evento => {
  if (!audio.src || !duracaoAudio()) return;

  audio.currentTime =
    (Number(evento.target.value) / 100) * duracaoAudio();
});

/* =========================================================
   LEGENDAS
========================================================= */

function recalcularFins() {
  legendas.forEach((legenda, indice) => {
    if (!Number.isFinite(legenda.inicio)) {
      legenda.inicio = 0;
    }

    if (!Number.isFinite(legenda.fim)) {
      legenda.fim = legenda.inicio;
    }

    if (indice < legendas.length - 1) {
      if (legenda.fim > legendas[indice + 1].inicio) {
        legenda.fim = legendas[indice + 1].inicio;
      }
    }

    legenda.inicio = Math.max(0, legenda.inicio);
    legenda.fim = Math.max(legenda.inicio, legenda.fim);
  });
}

function alterarInicio(indice, valor) {
  const legenda = legendas[indice];

  if (!legenda) return;

  const novoInicio = limitar(
    lerTempo(valor),
    0,
    duracaoAudio() || Infinity
  );

  legenda.inicio = novoInicio;

  if (legenda.fim < novoInicio) {
    legenda.fim = novoInicio;
  }

  if (indice > 0 && legendas[indice - 1].fim > novoInicio) {
    legendas[indice - 1].fim = novoInicio;
  }

  desenharLista();
}

function alterarFim(indice, valor) {
  const legenda = legendas[indice];

  if (!legenda) return;

  const limite = duracaoAudio() || Infinity;

  let novoFim = limitar(
    lerTempo(valor),
    legenda.inicio,
    limite
  );

  if (indice < legendas.length - 1) {
    novoFim = Math.min(
      novoFim,
      legendas[indice + 1].inicio
    );
  }

  legenda.fim = novoFim;
  desenharLista();
}

function linhaAtiva(tempo = audio.currentTime) {
  return legendas.find(legenda =>
    tempo >= legenda.inicio && tempo < legenda.fim
  ) || null;
}

function criarLinhas() {
  const texto = $("letra").value.trim();

  if (!texto) {
    mensagem("Digite ou cole a letra antes de criar as legendas.");
    return;
  }

  const linhas = texto
    .split(/\r?\n/)
    .map(linha => linha.trim())
    .filter(Boolean);

  if (!linhas.length) {
    mensagem("Não foram encontradas linhas na letra.");
    return;
  }

  const duracao = duracaoAudio();
  const intervalo = duracao > 0
    ? duracao / linhas.length
    : 4;

  legendas = linhas.map((textoLinha, indice) => ({
    id: indice + 1,
    texto: textoLinha,
    inicio: indice * intervalo,
    fim: (indice + 1) * intervalo
  }));

  desenharLista();

  mensagem(
    duracao > 0
      ? "Legendas criadas. Ajuste os tempos conforme a música."
      : "Legendas criadas com tempos provisórios de 4 segundos. Importe o áudio para sincronizar."
  );
}

$("criarLinhas").addEventListener("click", criarLinhas);

function marcarTempoAtual() {
  const seletor = $("linhaSelecionada");
  const indice = Number(seletor.value);

  if (seletor.value === "" || !legendas[indice]) {
    mensagem("Selecione uma legenda antes de marcar o tempo.");
    return;
  }

  alterarInicio(indice, audio.currentTime);

  seletor.value = String(indice);
  mensagem("Início da legenda marcado em " + fmtTempo(audio.currentTime) + ".");
}

$("marcarTempo").addEventListener("click", marcarTempoAtual);

function desenharLista() {
  const lista = $("listaLegendas");
  const seletor = $("linhaSelecionada");
  const valorAnterior = seletor.value;

  lista.replaceChildren();
  seletor.replaceChildren();

  if (!legendas.length) {
    const vazio = document.createElement("p");
    vazio.className = "muted";
    vazio.textContent = "Crie as legendas para começar.";
    lista.appendChild(vazio);

    const opcao = document.createElement("option");
    opcao.value = "";
    opcao.textContent = "Nenhuma legenda disponível";
    seletor.appendChild(opcao);

    $("contadorLegendas").textContent = "0 LINHAS";
    return;
  }

  $("contadorLegendas").textContent =
    legendas.length + (legendas.length === 1 ? " LINHA" : " LINHAS");

  legendas.forEach((legenda, indice) => {
    const opcao = document.createElement("option");
    opcao.value = String(indice);
    opcao.textContent = `${indice + 1}. ${legenda.texto}`;
    seletor.appendChild(opcao);

    const linha = document.createElement("article");
    linha.className = "lyric-row";
    linha.dataset.indice = String(indice);

    const titulo = document.createElement("label");
    titulo.textContent = `Legenda ${indice + 1}`;

    const campoTexto = document.createElement("input");
    campoTexto.type = "text";
    campoTexto.value = legenda.texto;
    campoTexto.setAttribute("aria-label", `Texto da legenda ${indice + 1}`);

    campoTexto.addEventListener("change", () => {
      legenda.texto = campoTexto.value;
      desenharLista();
    });

    const tempos = document.createElement("div");
    tempos.className = "time-fields";

    const grupoInicio = document.createElement("div");
    const rotuloInicio = document.createElement("label");
    rotuloInicio.textContent = "Início (segundos)";

    const campoInicio = document.createElement("input");
    campoInicio.type = "number";
    campoInicio.min = "0";
    campoInicio.step = "0.01";
    campoInicio.value = legenda.inicio.toFixed(2);
    campoInicio.setAttribute("aria-label", `Início da legenda ${indice + 1}`);

    campoInicio.addEventListener("change", () => {
      alterarInicio(indice, campoInicio.value);
    });

    grupoInicio.append(rotuloInicio, campoInicio);

    const grupoFim = document.createElement("div");
    const rotuloFim = document.createElement("label");
    rotuloFim.textContent = "Fim (segundos)";

    const campoFim = document.createElement("input");
    campoFim.type = "number";
    campoFim.min = "0";
    campoFim.step = "0.01";
    campoFim.value = legenda.fim.toFixed(2);
    campoFim.setAttribute("aria-label", `Fim da legenda ${indice + 1}`);

    campoFim.addEventListener("change", () => {
      alterarFim(indice, campoFim.value);
    });

    grupoFim.append(rotuloFim, campoFim);
    tempos.append(grupoInicio, grupoFim);

    const botoes = document.createElement("div");
    botoes.className = "button-row";

    const ouvir = document.createElement("button");
    ouvir.type = "button";
    ouvir.className = "secondary";
    ouvir.textContent = "▶ Ouvir a partir desta linha";

    ouvir.addEventListener("click", async () => {
      if (!audio.src) {
        mensagem("Importe uma música antes de ouvir a legenda.");
        return;
      }

      audio.currentTime = legenda.inicio;

      try {
        await audio.play();
      } catch (erro) {
        console.error(erro);
        mensagem("Não foi possível reproduzir o áudio.");
      }
    });

    const excluir = document.createElement("button");
    excluir.type = "button";
    excluir.className = "danger";
    excluir.textContent = "Excluir";

    excluir.addEventListener("click", () => {
      legendas.splice(indice, 1);
      legendas.forEach((item, i) => {
        item.id = i + 1;
      });

      desenharLista();
    });

    botoes.append(ouvir, excluir);
    linha.append(titulo, campoTexto, tempos, botoes);
    lista.appendChild(linha);
  });

  if (valorAnterior !== "" && legendas[Number(valorAnterior)]) {
    seletor.value = valorAnterior;
  } else {
    seletor.value = "0";
  }

  atualizarLinhasAtivas();
}

function atualizarLinhasAtivas() {
  const tempo = audio.currentTime;

  document.querySelectorAll(".lyric-row").forEach(elemento => {
    const indice = Number(elemento.dataset.indice);
    const legenda = legendas[indice];

    elemento.classList.toggle(
      "is-active",
      Boolean(
        legenda &&
        tempo >= legenda.inicio &&
        tempo < legenda.fim
      )
    );
  });
}

/* =========================================================
   CONFIGURAÇÕES VISUAIS
========================================================= */

function configurarFormato() {
  const formato = $("formato").value;

  if (formato === "horizontal") {
    canvas.width = 1280;
    canvas.height = 720;
    $("resolucao").textContent = "1280 × 720";
    $("proporcao").textContent = "16:9 · Horizontal";
  } else {
    canvas.width = 720;
    canvas.height = 1280;
    $("resolucao").textContent = "720 × 1280";
    $("proporcao").textContent = "9:16 · Vertical";
  }

  elementosVisuais.forEach(elemento => {
    elemento.x = limitar(elemento.x, 0, canvas.width);
    elemento.y = limitar(elemento.y, 0, canvas.height);
  });
}

$("formato").addEventListener("change", configurarFormato);

$("tamanhoTexto").addEventListener("input", () => {
  $("valorTamanho").textContent = $("tamanhoTexto").value + " px";
});

[
  "corFundo",
  "corTexto",
  "corDestaque",
  "tamanhoTexto",
  "posicaoTexto",
  "mostrarAudio"
].forEach(id => {
  $(id).addEventListener("input", () => {});
});

/* =========================================================
   VISUALIZAÇÃO DO ÁUDIO
========================================================= */

function obterAudioGraph() {
  if (audioContext) return;

  const AudioContextClass =
    window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error("Este navegador não oferece suporte à Web Audio API.");
  }

  audioContext = new AudioContextClass();

  sourceNode = audioContext.createMediaElementSource(audio);
  analyser = audioContext.createAnalyser();
  audioDestination = audioContext.createMediaStreamDestination();

  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.8;

  sourceNode.connect(analyser);
  analyser.connect(audioContext.destination);
  analyser.connect(audioDestination);
}

function desenharVisualizador() {
  if (!$("mostrarAudio").checked || !analyser) return;

  const quantidade = 36;
  const dados = new Uint8Array(analyser.frequencyBinCount);

  analyser.getByteFrequencyData(dados);

  const larguraTotal = canvas.width * 0.76;
  const larguraBarra = larguraTotal / quantidade * 0.55;
  const espaco = larguraTotal / quantidade;
  const inicioX = (canvas.width - larguraTotal) / 2;
  const baseY = canvas.height * 0.87;
  const alturaMaxima = canvas.height * 0.055;

  ctx.fillStyle = $("corDestaque").value;

  for (let i = 0; i < quantidade; i++) {
    const valor = dados[i] || 0;
    const altura = Math.max(3, (valor / 255) * alturaMaxima);
    const x = inicioX + i * espaco;

    ctx.globalAlpha = 0.35 + (valor / 255) * 0.65;
    ctx.fillRect(x, baseY - altura, larguraBarra, altura);
  }

  ctx.globalAlpha = 1;
}

/* =========================================================
   DESENHO DAS LEGENDAS
========================================================= */

function desenharTexto() {
  const legenda = linhaAtiva();

  if (!legenda) return;

  const tamanho = Number($("tamanhoTexto").value) || 42;
  const corTexto = $("corTexto").value;
  const corDestaque = $("corDestaque").value;

  const escala = canvas.width / 720;
  const tamanhoReal = tamanho * escala;

  ctx.save();

  ctx.font = `700 ${tamanhoReal}px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  const margem = canvas.width * 0.09;
  const larguraMaxima = canvas.width - margem * 2;

  const palavras = legenda.texto.split(/\s+/);
  const linhasTexto = [];
  let linhaAtual = "";

  palavras.forEach(palavra => {
    const teste = linhaAtual ? `${linhaAtual} ${palavra}` : palavra;

    if (
      ctx.measureText(teste).width > larguraMaxima &&
      linhaAtual
    ) {
      linhasTexto.push(linhaAtual);
      linhaAtual = palavra;
    } else {
      linhaAtual = teste;
    }
  });

  if (linhaAtual) {
    linhasTexto.push(linhaAtual);
  }

  const alturaLinha = tamanhoReal * 1.25;
  const alturaBloco = linhasTexto.length * alturaLinha;

  let centroY;

  switch ($("posicaoTexto").value) {
    case "alto":
      centroY = canvas.height * 0.22;
      break;

    case "baixo":
      centroY = canvas.height * 0.74;
      break;

    default:
      centroY = canvas.height * 0.5;
  }

  const inicioY = centroY - alturaBloco / 2 + alturaLinha / 2;

  linhasTexto.forEach((texto, indice) => {
    const y = inicioY + indice * alturaLinha;

    ctx.lineWidth = Math.max(2, tamanhoReal * 0.09);
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.strokeText(texto, canvas.width / 2, y, larguraMaxima);

    ctx.fillStyle = corTexto;
    ctx.fillText(texto, canvas.width / 2, y, larguraMaxima);
  });

  ctx.restore();
}

/* =========================================================
   IMAGENS E FIGURINHAS
========================================================= */

function imagemSelecionada() {
  return elementosVisuais.find(
    elemento => elemento.id === elementoSelecionado
  ) || null;
}

function atualizarControlesImagem() {
  const elemento = imagemSelecionada();
  const possuiSelecao = Boolean(elemento);

  $("tamanhoImagem").disabled = !possuiSelecao;
  $("rotacaoImagem").disabled = !possuiSelecao;
  $("centralizarImagem").disabled = !possuiSelecao;
  $("excluirImagem").disabled = !possuiSelecao;

  if (!elemento) {
    $("valorTamanhoImagem").textContent = "100%";
    $("valorRotacaoImagem").textContent = "0°";
    $("estadoImagem").textContent =
      "Selecione uma imagem para habilitar os controles.";

    canvas.classList.remove("has-selection", "is-dragging");
    return;
  }

  $("tamanhoImagem").value = String(elemento.escala * 100);
  $("rotacaoImagem").value = String(elemento.rotacao);

  $("valorTamanhoImagem").textContent =
    Math.round(elemento.escala * 100) + "%";

  $("valorRotacaoImagem").textContent =
    Math.round(elemento.rotacao) + "°";

  $("estadoImagem").textContent =
    "Imagem selecionada. Arraste-a na prévia para reposicionar.";

  canvas.classList.add("has-selection");
}

function adicionarImagem(arquivo) {
  if (!arquivo) return;

  const tiposPermitidos = [
    "image/png",
    "image/jpeg",
    "image/webp"
  ];

  if (!tiposPermitidos.includes(arquivo.type)) {
    mensagem("Escolha uma imagem PNG, JPG ou WebP.");
    return;
  }

  const url = URL.createObjectURL(arquivo);
  const imagem = new Image();

  imagem.onload = () => {
    const limiteLargura = canvas.width * 0.42;
    const limiteAltura = canvas.height * 0.42;

    const fator = Math.min(
      limiteLargura / imagem.naturalWidth,
      limiteAltura / imagem.naturalHeight,
      1
    );

    const elemento = {
      id: proximoIdElemento++,
      nome: arquivo.name,
      url,
      imagem,
      x: canvas.width / 2,
      y: canvas.height / 2,
      larguraOriginal: imagem.naturalWidth * fator,
      alturaOriginal: imagem.naturalHeight * fator,
      escala: 1,
      rotacao: 0
    };

    elementosVisuais.push(elemento);
    elementoSelecionado = elemento.id;

    $("nomeImagem").textContent = arquivo.name;

    atualizarControlesImagem();
    mensagem("Imagem adicionada. Arraste-a para a posição desejada.");
  };

  imagem.onerror = () => {
    URL.revokeObjectURL(url);
    mensagem("Não foi possível carregar essa imagem.");
  };

  imagem.src = url;
}

$("arquivoImagem").addEventListener("change", evento => {
  const arquivo = evento.target.files?.[0];

  if (arquivo) {
    adicionarImagem(arquivo);
  }

  evento.target.value = "";
});

function desenharElementoVisual(elemento) {
  const largura = elemento.larguraOriginal * elemento.escala;
  const altura = elemento.alturaOriginal * elemento.escala;

  ctx.save();
  ctx.translate(elemento.x, elemento.y);
  ctx.rotate(elemento.rotacao * Math.PI / 180);

  ctx.drawImage(
    elemento.imagem,
    -largura / 2,
    -altura / 2,
    largura,
    altura
  );

  /*
   * A moldura de seleção é apenas uma ajuda visual do editor.
   * Ela não aparece no vídeo exportado.
   */
  if (!exportando && elemento.id === elementoSelecionado) {
    ctx.strokeStyle = "#80f2b5";
    ctx.lineWidth = Math.max(2, canvas.width / 360);
    ctx.setLineDash([
      Math.max(5, canvas.width / 100),
      Math.max(4, canvas.width / 150)
    ]);

    ctx.strokeRect(
      -largura / 2,
      -altura / 2,
      largura,
      altura
    );

    ctx.setLineDash([]);

    const tamanhoAlca = Math.max(7, canvas.width / 75);

    ctx.fillStyle = "#80f2b5";

    [
      [-largura / 2, -altura / 2],
      [largura / 2, -altura / 2],
      [-largura / 2, altura / 2],
      [largura / 2, altura / 2]
    ].forEach(([x, y]) => {
      ctx.fillRect(
        x - tamanhoAlca / 2,
        y - tamanhoAlca / 2,
        tamanhoAlca,
        tamanhoAlca
      );
    });
  }

  ctx.restore();
}

function obterCoordenadasCanvas(evento) {
  const retangulo = canvas.getBoundingClientRect();

  return {
    x: (evento.clientX - retangulo.left) * canvas.width / retangulo.width,
    y: (evento.clientY - retangulo.top) * canvas.height / retangulo.height
  };
}

function pontoDentroElemento(x, y, elemento) {
  const dx = x - elemento.x;
  const dy = y - elemento.y;

  const angulo = -elemento.rotacao * Math.PI / 180;

  const localX = dx * Math.cos(angulo) - dy * Math.sin(angulo);
  const localY = dx * Math.sin(angulo) + dy * Math.cos(angulo);

  const largura = elemento.larguraOriginal * elemento.escala;
  const altura = elemento.alturaOriginal * elemento.escala;

  return (
    Math.abs(localX) <= largura / 2 &&
    Math.abs(localY) <= altura / 2
  );
}

function localizarElemento(x, y) {
  /*
   * Elementos mais recentes são verificados primeiro,
   * pois aparecem por cima dos anteriores.
   */
  for (let i = elementosVisuais.length - 1; i >= 0; i--) {
    if (pontoDentroElemento(x, y, elementosVisuais[i])) {
      return elementosVisuais[i];
    }
  }

  return null;
}

canvas.addEventListener("pointerdown", evento => {
  const ponto = obterCoordenadasCanvas(evento);
  const elemento = localizarElemento(ponto.x, ponto.y);

  if (!elemento) {
    elementoSelecionado = null;
    arrasteElemento = null;
    atualizarControlesImagem();
    return;
  }

  evento.preventDefault();

  elementoSelecionado = elemento.id;

  arrasteElemento = {
    id: elemento.id,
    deslocamentoX: ponto.x - elemento.x,
    deslocamentoY: ponto.y - elemento.y,
    pointerId: evento.pointerId
  };

  try {
    canvas.setPointerCapture(evento.pointerId);
  } catch (_) {}

  atualizarControlesImagem();
});

canvas.addEventListener("pointermove", evento => {
  if (!arrasteElemento) return;

  if (evento.pointerId !== arrasteElemento.pointerId) return;

  evento.preventDefault();

  const elemento = imagemSelecionada();

  if (!elemento) return;

  const ponto = obterCoordenadasCanvas(evento);

  elemento.x = limitar(
    ponto.x - arrasteElemento.deslocamentoX,
    0,
    canvas.width
  );

  elemento.y = limitar(
    ponto.y - arrasteElemento.deslocamentoY,
    0,
    canvas.height
  );

  canvas.classList.add("is-dragging");
});

function terminarArraste(evento) {
  if (
    arrasteElemento &&
    evento &&
    evento.pointerId !== arrasteElemento.pointerId
  ) {
    return;
  }

  arrasteElemento = null;
  canvas.classList.remove("is-dragging");

  try {
    if (evento && canvas.hasPointerCapture(evento.pointerId)) {
      canvas.releasePointerCapture(evento.pointerId);
    }
  } catch (_) {}
}

canvas.addEventListener("pointerup", terminarArraste);
canvas.addEventListener("pointercancel", terminarArraste);
canvas.addEventListener("lostpointercapture", () => {
  arrasteElemento = null;
  canvas.classList.remove("is-dragging");
});

$("tamanhoImagem").addEventListener("input", evento => {
  const elemento = imagemSelecionada();

  if (!elemento) return;

  elemento.escala = Number(evento.target.value) / 100;

  $("valorTamanhoImagem").textContent =
    evento.target.value + "%";
});

$("rotacaoImagem").addEventListener("input", evento => {
  const elemento = imagemSelecionada();

  if (!elemento) return;

  elemento.rotacao = Number(evento.target.value);

  $("valorRotacaoImagem").textContent =
    elemento.rotacao + "°";
});

$("centralizarImagem").addEventListener("click", () => {
  const elemento = imagemSelecionada();

  if (!elemento) return;

  elemento.x = canvas.width / 2;
  elemento.y = canvas.height / 2;

  atualizarControlesImagem();
});

$("excluirImagem").addEventListener("click", () => {
  const elemento = imagemSelecionada();

  if (!elemento) return;

  elementosVisuais = elementosVisuais.filter(
    item => item.id !== elemento.id
  );

  URL.revokeObjectURL(elemento.url);
  elementoSelecionado = null;

  $("nomeImagem").textContent = elementosVisuais.length
    ? `${elementosVisuais.length} imagem(ns) no projeto`
    : "Nenhuma imagem adicionada.";

  atualizarControlesImagem();
  mensagem("Imagem removida.");
});

/* =========================================================
   RENDERIZAÇÃO DA PRÉVIA
========================================================= */

function renderizar() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = $("corFundo").value;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  desenharVisualizador();
  desenharTexto();

  /*
   * As imagens são desenhadas a cada quadro.
   * Por isso, também aparecem na gravação do canvas.
   */
  elementosVisuais.forEach(desenharElementoVisual);

  const progresso = duracaoAudio() > 0
    ? audio.currentTime / duracaoAudio()
    : 0;

  const margem = canvas.width * 0.08;
  const largura = canvas.width - margem * 2;
  const y = canvas.height * 0.94;
  const altura = Math.max(3, canvas.width / 240);

  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillRect(margem, y, largura, altura);

  ctx.fillStyle = $("corDestaque").value;
  ctx.fillRect(
    margem,
    y,
    largura * limitar(progresso, 0, 1),
    altura
  );

  /*
   * As indicações de seleção não são gravadas no vídeo.
   */
  if (!exportando && !linhaAtiva() && !elementosVisuais.length) {
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = `600 ${canvas.width * 0.035}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      "LYRIC STUDIO",
      canvas.width / 2,
      canvas.height / 2
    );
    ctx.restore();
  }

  atualizarLinhasAtivas();

  animacao = requestAnimationFrame(renderizar);
}

/* =========================================================
   EXPORTAÇÃO DO VÍDEO
========================================================= */

function escolherTipoGravacao() {
  if (!window.MediaRecorder) return "";

  const tipos = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];

  return tipos.find(tipo => {
    try {
      return MediaRecorder.isTypeSupported(tipo);
    } catch (_) {
      return false;
    }
  }) || "";
}

async function exportarVideo() {
  if (!audio.src) {
    mensagem("Importe uma música antes de exportar.");
    return;
  }

  if (exportando) {
    mensagem("A exportação já está em andamento.");
    return;
  }

  if (!canvas.captureStream || !window.MediaRecorder) {
    mensagem(
      "Este navegador não oferece suporte à gravação do vídeo. Tente usar uma versão atualizada do Chrome ou Edge."
    );
    return;
  }

  let streamCanvas;

  try {
    obterAudioGraph();

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const tipo = escolherTipoGravacao();

    if (!tipo) {
      mensagem(
        "Não foi encontrado um formato de gravação compatível neste navegador."
      );
      return;
    }

    streamCanvas = canvas.captureStream(30);

    const faixasAudio =
      audioDestination.stream.getAudioTracks();

    const faixasVideo =
      streamCanvas.getVideoTracks();

    const streamFinal = new MediaStream([
      ...faixasVideo,
      ...faixasAudio
    ]);

    chunks = [];

    recorder = new MediaRecorder(streamFinal, {
      mimeType: tipo
    });

    recorder.ondataavailable = evento => {
      if (evento.data && evento.data.size > 0) {
        chunks.push(evento.data);
      }
    };

    recorder.onerror = evento => {
      console.error("Erro de gravação:", evento.error);
      mensagem("Ocorreu um erro durante a exportação.");
    };

    recorder.onstop = () => {
      exportando = false;

      $("exportar").disabled = false;
      $("pararExportacao").disabled = true;

      streamFinal.getTracks().forEach(faixa => faixa.stop());

      if (!chunks.length) {
        mensagem("Nenhum dado de vídeo foi gerado.");
        return;
      }

      const blob = new Blob(chunks, { type: tipo });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      const extensao = tipo.includes("mp4") ? "mp4" : "webm";

      link.href = url;
      link.download = `lyric-studio-${Date.now()}.${extensao}`;

      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(() => URL.revokeObjectURL(url), 60000);

      mensagem(
        `Exportação concluída. Arquivo gerado em ${extensao.toUpperCase()}.`
      );

      audio.removeEventListener("ended", pararAoTerminar);
    };

    function pararAoTerminar() {
      if (
        recorder &&
        recorder.state !== "inactive"
      ) {
        recorder.stop();
      }
    }

    audio.addEventListener("ended", pararAoTerminar);

    audioAnterior = audio.currentTime;
    audio.currentTime = 0;

    exportando = true;
    $("exportar").disabled = true;
    $("pararExportacao").disabled = false;

    /*
     * A seleção visual é removida durante a exportação.
     * A imagem continua desenhada no canvas.
     */
    recorder.start(1000);

    await audio.play();

    mensagem("Exportando vídeo. Aguarde a música terminar.");
  } catch (erro) {
    console.error("Erro ao iniciar a exportação:", erro);

    exportando = false;
    $("exportar").disabled = false;
    $("pararExportacao").disabled = true;

    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch (_) {}
    }

    if (streamCanvas) {
      streamCanvas.getTracks().forEach(faixa => faixa.stop());
    }

    mensagem(
      "Não foi possível iniciar a exportação. Verifique o áudio e tente novamente."
    );
  }
}

$("exportar").addEventListener("click", exportarVideo);

$("pararExportacao").addEventListener("click", () => {
  if (recorder && recorder.state !== "inactive") {
    recorder.stop();
    audio.pause();
  }
});

/* =========================================================
   LIMPEZA
========================================================= */

window.addEventListener("beforeunload", () => {
  if (arquivoURL) {
    URL.revokeObjectURL(arquivoURL);
  }

  elementosVisuais.forEach(elemento => {
    URL.revokeObjectURL(elemento.url);
  });

  if (animacao) {
    cancelAnimationFrame(animacao);
  }

  if (recorder && recorder.state !== "inactive") {
    try {
      recorder.stop();
    } catch (_) {}
  }

  if (audioContext && audioContext.state !== "closed") {
    audioContext.close();
  }
});

/* =========================================================
   INICIALIZAÇÃO
========================================================= */

configurarFormato();
atualizarControlesImagem();
renderizar();