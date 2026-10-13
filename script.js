"use strict";

/* =========================================================
   LYRIC STUDIO
   Áudio, legendas, fontes, animações, efeitos, vídeos,
   LUT .CUBE, adesivos e exportação
========================================================= */

const $ = id => document.getElementById(id);

const audio = $("audio");
const canvas = $("canvas");
const ctx = canvas.getContext("2d", { alpha: false });
const videoFundo = $("videoFundo");

let audioURL = null;
let videoURL = null;
let fonteURL = null;
let audioContext = null;
let sourceNode = null;
let audioDestination = null;
let analisador = null;
let dadosAudio = null;

let legendas = [];
let indiceSelecionado = -1;
let elementosVisuais = [];
let imagemSelecionada = null;
let contadorImagens = 0;

let fontePersonalizada = null;
let lut = null;
let exportando = false;
let mediaRecorder = null;
let partesVideo = [];
let rafId = null;
let arrastando = false;
let ultimaPosicao = null;

const fundoLUT = document.createElement("canvas");
const fundoLUTctx = fundoLUT.getContext("2d", {
  willReadFrequently: true
});

const tiposLUT = {
  size: 0,
  domainMin: [0, 0, 0],
  domainMax: [1, 1, 1],
  tabela: []
};

/* =========================================================
   UTILITÁRIOS
========================================================= */

function mensagem(texto) {
  $("mensagem").textContent = texto;
}

function formatarTempo(segundos) {
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

function tempoParaCampo(segundos) {
  if (!Number.isFinite(segundos) || segundos < 0) {
    segundos = 0;
  }

  const horas = Math.floor(segundos / 3600);
  const minutos = Math.floor((segundos % 3600) / 60);
  const segundosRestantes = segundos % 60;

  return (
    String(horas).padStart(2, "0") +
    ":" +
    String(minutos).padStart(2, "0") +
    ":" +
    segundosRestantes.toFixed(2).padStart(5, "0")
  );
}

function campoParaTempo(valor) {
  if (typeof valor === "number") {
    return Math.max(0, valor);
  }

  const texto = String(valor || "").trim();

  if (!texto) {
    return 0;
  }

  if (/^\d+([.,]\d+)?$/.test(texto)) {
    return Math.max(0, Number(texto.replace(",", ".")) || 0);
  }

  const partes = texto.split(":").map(Number);

  if (
    partes.some(n => !Number.isFinite(n)) ||
    partes.length > 3
  ) {
    return 0;
  }

  if (partes.length === 3) {
    return Math.max(
      0,
      partes[0] * 3600 + partes[1] * 60 + partes[2]
    );
  }

  if (partes.length === 2) {
    return Math.max(0, partes[0] * 60 + partes[1]);
  }

  return 0;
}

function limitar(valor, minimo, maximo) {
  return Math.max(minimo, Math.min(maximo, valor));
}

function corValida(cor, fallback) {
  return /^#[0-9a-f]{6}$/i.test(cor) ? cor : fallback;
}

function obterDuracao() {
  return Number.isFinite(audio.duration) ? audio.duration : 0;
}

function atualizarTempo() {
  $("tempoAtual").textContent = formatarTempo(audio.currentTime || 0);
  $("tempoPreview").textContent = formatarTempo(audio.currentTime || 0);

  const duracao = obterDuracao();

  $("duracao").textContent = formatarTempo(duracao);
  $("seek").max = duracao || 100;
  $("seek").value = audio.currentTime || 0;
}

function definirFormato() {
  const formato = $("formato").value;
  const resolucao = Number($("resolucao").value) || 1080;

  if (formato === "horizontal") {
    canvas.width = Math.round(resolucao * 16 / 9);
    canvas.height = resolucao;
    $("proporcao").textContent = "16:9 · Horizontal";
  } else if (formato === "quadrado") {
    canvas.width = resolucao;
    canvas.height = resolucao;
    $("proporcao").textContent = "1:1 · Quadrado";
  } else {
    canvas.width = Math.round(resolucao * 9 / 16);
    canvas.height = resolucao;
    $("proporcao").textContent = "9:16 · Vertical";
  }

  renderizar();
}

function definirTamanhoTexto() {
  $("valorTamanho").textContent = $("tamanhoTexto").value + " px";
}

function definirTamanhoImagem() {
  $("valorTamanhoImagem").textContent =
    $("tamanhoImagem").value + "%";
}

function definirRotacaoImagem() {
  $("valorRotacaoImagem").textContent =
    $("rotacaoImagem").value + "°";
}

function legendaSelecionada() {
  return legendas[indiceSelecionado] || null;
}

/* =========================================================
   ÁUDIO
========================================================= */

function prepararAudioContext() {
  if (audioContext) {
    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }
    return;
  }

  const AudioContextClass =
    window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    return;
  }

  audioContext = new AudioContextClass();

  try {
    sourceNode = audioContext.createMediaElementSource(audio);

    analisador = audioContext.createAnalyser();
    analisador.fftSize = 256;
    analisador.smoothingTimeConstant = 0.78;

    dadosAudio = new Uint8Array(analisador.frequencyBinCount);

    audioDestination = audioContext.createMediaStreamDestination();

    sourceNode.connect(analisador);
    analisador.connect(audioContext.destination);
    analisador.connect(audioDestination);
  } catch (erro) {
    console.error("Não foi possível preparar o áudio:", erro);
  }
}

$("arquivoAudio").addEventListener("change", event => {
  const arquivo = event.target.files[0];

  if (!arquivo) return;

  if (!arquivo.type.startsWith("audio/")) {
    mensagem("Selecione um arquivo de áudio válido.");
    return;
  }

  if (audioURL) URL.revokeObjectURL(audioURL);

  audio.pause();

  audioURL = URL.createObjectURL(arquivo);
  audio.src = audioURL;
  audio.load();

  $("nomeAudio").textContent = arquivo.name;
  mensagem("Áudio carregado. Aguarde a duração ser identificada.");

  audio.addEventListener("loadedmetadata", function aoCarregar() {
    audio.removeEventListener("loadedmetadata", aoCarregar);

    atualizarTempo();

    if (legendas.length) {
      recalcularFins();
      desenharLista();
    }

    mensagem("Áudio pronto para reprodução e sincronização.");
    renderizar();
  });
});

$("playPause").addEventListener("click", async () => {
  if (!audio.src) {
    mensagem("Importe um áudio antes de reproduzir.");
    return;
  }

  prepararAudioContext();

  if (audioContext && audioContext.state === "suspended") {
    await audioContext.resume();
  }

  if (audio.paused) {
    try {
      await audio.play();

      if (videoFundo.src && videoFundo.paused) {
        videoFundo.play().catch(() => {});
      }

      $("playPause").textContent = "Ⅱ";
    } catch (erro) {
      mensagem("Não foi possível reproduzir o áudio neste momento.");
    }
  } else {
    audio.pause();
    $("playPause").textContent = "▶";
  }
});

$("voltar").addEventListener("click", () => {
  audio.currentTime = Math.max(0, audio.currentTime - 5);
});

$("avancar").addEventListener("click", () => {
  audio.currentTime = Math.min(
    obterDuracao() || Infinity,
    audio.currentTime + 5
  );
});

$("seek").addEventListener("input", () => {
  if (audio.src) {
    audio.currentTime = Number($("seek").value);
  } else {
    renderizar();
  }
});

audio.addEventListener("timeupdate", atualizarTempo);
audio.addEventListener("seeked", renderizar);

audio.addEventListener("play", () => {
  $("playPause").textContent = "Ⅱ";
});

audio.addEventListener("pause", () => {
  $("playPause").textContent = "▶";
});

audio.addEventListener("ended", () => {
  $("playPause").textContent = "▶";

  if (exportando && mediaRecorder?.state === "recording") {
    mediaRecorder.stop();
  }
});

audio.addEventListener("error", () => {
  if (audio.src) {
    mensagem(
      "O navegador não conseguiu abrir este áudio. Tente outro formato."
    );
  }
});

/* =========================================================
   CRIAÇÃO E EDIÇÃO DE LEGENDAS
========================================================= */

$("criarLinhas").addEventListener("click", () => {
  const texto = $("letra").value.trim();

  if (!texto) {
    mensagem("Cole a letra antes de criar as legendas.");
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

  const duracao = obterDuracao();
  const intervalo = duracao > 0 ? duracao / linhas.length : 3;

  legendas = linhas.map((textoLinha, indice) => ({
    id: crypto.randomUUID
      ? crypto.randomUUID()
      : String(Date.now() + indice),
    texto: textoLinha,
    inicio: indice * intervalo,
    fim: (indice + 1) * intervalo
  }));

  indiceSelecionado = 0;

  atualizarSeletorLegendas();
  desenharLista();
  renderizar();

  mensagem(
    duracao > 0
      ? "Legendas criadas. Ajuste o tempo de cada linha."
      : "Legendas criadas. Importe o áudio para sincronizar os tempos."
  );
});

function atualizarSeletorLegendas() {
  const seletor = $("linhaSelecionada");
  seletor.innerHTML = "";

  if (!legendas.length) {
    const opcao = document.createElement("option");
    opcao.value = "";
    opcao.textContent = "Nenhuma legenda";
    seletor.appendChild(opcao);
    return;
  }

  legendas.forEach((legenda, indice) => {
    const opcao = document.createElement("option");
    opcao.value = indice;
    opcao.textContent =
      String(indice + 1).padStart(2, "0") + " — " +
      legenda.texto.slice(0, 55);

    seletor.appendChild(opcao);
  });

  seletor.value = String(indiceSelecionado);
}

$("linhaSelecionada").addEventListener("change", () => {
  indiceSelecionado = Number($("linhaSelecionada").value);

  if (!Number.isInteger(indiceSelecionado)) {
    indiceSelecionado = -1;
  }

  desenharLista();
  renderizar();
});

$("marcarInicio").addEventListener("click", () => {
  const legenda = legendaSelecionada();

  if (!legenda) {
    mensagem("Selecione uma legenda primeiro.");
    return;
  }

  legenda.inicio = Math.max(0, audio.currentTime || 0);

  if (legenda.fim <= legenda.inicio) {
    legenda.fim = legenda.inicio + 1;
  }

  desenharLista();
  atualizarSeletorLegendas();
  renderizar();

  mensagem("Início da legenda atualizado.");
});

$("marcarTempo").addEventListener("click", () => {
  const legenda = legendaSelecionada();

  if (!legenda) {
    mensagem("Selecione uma legenda primeiro.");
    return;
  }

  const tempoAtual = Math.max(0, audio.currentTime || 0);

  if (tempoAtual <= legenda.inicio) {
    mensagem("O fim deve acontecer depois do início.");
    return;
  }

  legenda.fim = tempoAtual;

  desenharLista();
  renderizar();

  mensagem("Fim da legenda atualizado.");
});

function recalcularFins() {
  for (let i = 0; i < legendas.length; i++) {
    const legenda = legendas[i];

    legenda.inicio = Math.max(0, Number(legenda.inicio) || 0);
    legenda.fim = Math.max(legenda.inicio, Number(legenda.fim) || 0);

    if (i + 1 < legendas.length && legenda.fim <= legenda.inicio) {
      legenda.fim = Math.max(
        legenda.inicio + 0.5,
        legendas[i + 1].inicio
      );
    }
  }
}

function selecionarLegenda(indice) {
  indiceSelecionado = indice;
  $("linhaSelecionada").value = String(indice);

  desenharLista();
  renderizar();
}

function desenharLista() {
  const lista = $("listaLegendas");
  lista.innerHTML = "";

  $("contadorLegendas").textContent =
    legendas.length + (legendas.length === 1 ? " legenda" : " legendas");

  if (!legendas.length) {
    const vazio = document.createElement("div");
    vazio.className = "empty-state";
    vazio.textContent = "Suas legendas aparecerão aqui.";
    lista.appendChild(vazio);
    atualizarSeletorLegendas();
    return;
  }

  legendas.forEach((legenda, indice) => {
    const linha = document.createElement("div");

    linha.className =
      "caption-row" +
      (indice === indiceSelecionado ? " selected" : "");

    const tempos = document.createElement("div");
    tempos.className = "caption-times";

    const campoInicio = document.createElement("input");
    campoInicio.type = "text";
    campoInicio.value = tempoParaCampo(legenda.inicio);
    campoInicio.title = "Início: HH:MM:SS ou segundos";
    campoInicio.setAttribute("aria-label", "Início da legenda");

    const campoFim = document.createElement("input");
    campoFim.type = "text";
    campoFim.value = tempoParaCampo(legenda.fim);
    campoFim.title = "Fim: HH:MM:SS ou segundos";
    campoFim.setAttribute("aria-label", "Fim da legenda");

    tempos.append(campoInicio, campoFim);

    const conteudo = document.createElement("div");
    conteudo.className = "caption-content";

    const texto = document.createElement("textarea");
    texto.value = legenda.texto;
    texto.setAttribute("aria-label", "Texto da legenda");
    texto.placeholder = "Texto da legenda";

    const acoes = document.createElement("div");
    acoes.className = "caption-actions";

    const irInicio = document.createElement("button");
    irInicio.type = "button";
    irInicio.textContent = "Ir para início";

    const duplicar = document.createElement("button");
    duplicar.type = "button";
    duplicar.textContent = "Duplicar";

    const excluir = document.createElement("button");
    excluir.type = "button";
    excluir.textContent = "Excluir";

    linha.addEventListener("click", () => {
      if (indiceSelecionado !== indice) {
        selecionarLegenda(indice);
      }
    });

    campoInicio.addEventListener("change", () => {
      legenda.inicio = campoParaTempo(campoInicio.value);

      if (legenda.fim <= legenda.inicio) {
        legenda.fim = legenda.inicio + 0.5;
      }

      campoInicio.value = tempoParaCampo(legenda.inicio);
      campoFim.value = tempoParaCampo(legenda.fim);

      atualizarSeletorLegendas();
      renderizar();
    });

    campoFim.addEventListener("change", () => {
      legenda.fim = campoParaTempo(campoFim.value);

      if (legenda.fim <= legenda.inicio) {
        legenda.fim = legenda.inicio + 0.5;
      }

      campoFim.value = tempoParaCampo(legenda.fim);
      renderizar();
    });

    texto.addEventListener("input", () => {
      legenda.texto = texto.value;
      atualizarSeletorLegendas();
      renderizar();
    });

    irInicio.addEventListener("click", event => {
      event.stopPropagation();

      if (audio.src) {
        audio.currentTime = legenda.inicio;
      }

      selecionarLegenda(indice);
    });

    duplicar.addEventListener("click", event => {
      event.stopPropagation();

      const nova = {
        id: String(Date.now()),
        texto: legenda.texto,
        inicio: legenda.fim,
        fim: legenda.fim + Math.max(1, legenda.fim - legenda.inicio)
      };

      legendas.splice(indice + 1, 0, nova);
      indiceSelecionado = indice + 1;

      atualizarSeletorLegendas();
      desenharLista();
      renderizar();
    });

    excluir.addEventListener("click", event => {
      event.stopPropagation();

      legendas.splice(indice, 1);

      if (!legendas.length) {
        indiceSelecionado = -1;
      } else {
        indiceSelecionado = Math.min(
          indiceSelecionado,
          legendas.length - 1
        );
      }

      atualizarSeletorLegendas();
      desenharLista();
      renderizar();
    });

    acoes.append(irInicio, duplicar, excluir);
    conteudo.append(texto, acoes);
    linha.append(tempos, conteudo);
    lista.appendChild(linha);
  });

  atualizarSeletorLegendas();
}

function linhaAtiva(tempo) {
  return legendas.find(legenda =>
    tempo >= legenda.inicio && tempo < legenda.fim
  ) || null;
}

/* =========================================================
   IMPORTAÇÃO DE FONTES
========================================================= */

$("arquivoFonte").addEventListener("change", async event => {
  const arquivo = event.target.files[0];

  if (!arquivo) return;

  const extensao = arquivo.name.split(".").pop().toLowerCase();

  if (!["ttf", "otf", "woff", "woff2"].includes(extensao)) {
    mensagem("Formato de fonte não reconhecido.");
    return;
  }

  try {
    if (fonteURL) {
      URL.revokeObjectURL(fonteURL);
    }

    fonteURL = URL.createObjectURL(arquivo);

    const nomeInterno = "FonteLyricCustom";

    const face = new FontFace(
      nomeInterno,
      `url("${fonteURL}")`
    );

    await face.load();
    document.fonts.add(face);

    fontePersonalizada = nomeInterno;

    const opcao = [...$("fonteTexto").options].find(
      item => item.value === "custom"
    );

    if (opcao) {
      opcao.textContent = arquivo.name;
    }

    $("fonteTexto").value = "custom";
    $("nomeFonte").textContent = "Fonte carregada: " + arquivo.name;

    mensagem("Fonte importada e aplicada.");
    renderizar();
  } catch (erro) {
    console.error(erro);
    mensagem("Não foi possível carregar esta fonte.");
  }
});

/* =========================================================
   VÍDEO DE FUNDO
========================================================= */

$("arquivoVideo").addEventListener("change", event => {
  const arquivo = event.target.files[0];

  if (!arquivo) return;

  const extensao = arquivo.name.split(".").pop().toLowerCase();

  if (!["mov", "mp4", "webm"].includes(extensao)) {
    mensagem("Formato não reconhecido. Use MOV, MP4 ou WEBM.");
    return;
  }

  if (videoURL) {
    URL.revokeObjectURL(videoURL);
  }

  videoFundo.pause();

  videoURL = URL.createObjectURL(arquivo);
  videoFundo.src = videoURL;
  videoFundo.load();

  $("nomeVideo").textContent = arquivo.name;

  videoFundo.onloadeddata = () => {
    videoFundo.currentTime = 0;

    videoFundo.play().catch(() => {
      mensagem(
        "Vídeo carregado. Clique em Reproduzir fundo para iniciar."
      );
    });

    mensagem("Vídeo de fundo carregado.");
    renderizar();
  };

  videoFundo.onerror = () => {
    mensagem(
      "O navegador não conseguiu decodificar este vídeo. Tente MP4 H.264 ou WEBM compatível."
    );
  };
});

$("reproduzirFundo").addEventListener("click", async () => {
  if (!videoFundo.src) {
    mensagem("Importe um vídeo de fundo primeiro.");
    return;
  }

  try {
    await videoFundo.play();
    mensagem("Reprodução do fundo iniciada.");
  } catch (erro) {
    mensagem("Não foi possível reproduzir o vídeo de fundo.");
  }
});

$("removerVideo").addEventListener("click", () => {
  videoFundo.pause();
  videoFundo.removeAttribute("src");
  videoFundo.load();

  if (videoURL) {
    URL.revokeObjectURL(videoURL);
    videoURL = null;
  }

  $("arquivoVideo").value = "";
  $("nomeVideo").textContent = "Nenhum vídeo de fundo selecionado";

  mensagem("Vídeo de fundo removido.");
  renderizar();
});

/* =========================================================
   IMPORTAÇÃO DE LUT .CUBE
========================================================= */

function analisarLUT(conteudo) {
  const linhas = conteudo.split(/\r?\n/);

  let tamanho = 0;
  let domainMin = [0, 0, 0];
  let domainMax = [1, 1, 1];
  const tabela = [];

  for (const linhaOriginal of linhas) {
    const linha = linhaOriginal
      .replace(/#.*/, "")
      .trim();

    if (!linha) continue;

    const partes = linha.split(/\s+/);
    const comando = partes[0].toUpperCase();

    if (comando === "TITLE") continue;

    if (comando === "LUT_3D_SIZE") {
      tamanho = Number(partes[1]);
      continue;
    }

    if (comando === "DOMAIN_MIN") {
      domainMin = partes.slice(1, 4).map(Number);
      continue;
    }

    if (comando === "DOMAIN_MAX") {
      domainMax = partes.slice(1, 4).map(Number);
      continue;
    }

    if (
      ["LUT_1D_SIZE", "LUT_1D_INPUT_RANGE", "LUT_1D_OUTPUT_RANGE"]
        .includes(comando)
    ) {
      throw new Error(
        "Esta ferramenta aceita LUT 3D. Exporte a LUT como .CUBE 3D."
      );
    }

    if (partes.length >= 3) {
      const valores = partes.slice(0, 3).map(Number);

      if (valores.every(Number.isFinite)) {
        tabela.push(valores);
      }
    }
  }

  if (!Number.isInteger(tamanho) || tamanho < 2 || tamanho > 64) {
    throw new Error("O tamanho da LUT 3D é inválido ou não foi encontrado.");
  }

  if (tabela.length !== tamanho ** 3) {
    throw new Error(
      `LUT incompleta: esperados ${tamanho ** 3} pontos, encontrados ${tabela.length}.`
    );
  }

  return {
    size: tamanho,
    domainMin,
    domainMax,
    tabela
  };
}

$("arquivoLUT").addEventListener("change", async event => {
  const arquivo = event.target.files[0];

  if (!arquivo) return;

  try {
    const conteudo = await arquivo.text();
    lut = analisarLUT(conteudo);

    $("nomeLUT").textContent =
      `${arquivo.name} — LUT 3D ${lut.size}³ carregada`;

    mensagem("LUT carregada e aplicada ao vídeo de fundo.");
    renderizar();
  } catch (erro) {
    lut = null;
    $("nomeLUT").textContent = "Não foi possível carregar esta LUT.";
    mensagem(erro.message || "Arquivo LUT inválido.");
  }
});

$("removerLUT").addEventListener("click", () => {
  lut = null;
  $("arquivoLUT").value = "";
  $("nomeLUT").textContent = "Nenhuma LUT selecionada";

  mensagem("LUT removida.");
  renderizar();
});

function obterPontoLUT(r, g, b) {
  const n = lut.size;

  const index = (ri, gi, bi) =>
    (bi * n * n) + (gi * n) + ri;

  const r0 = Math.floor(r);
  const g0 = Math.floor(g);
  const b0 = Math.floor(b);

  const r1 = Math.min(n - 1, r0 + 1);
  const g1 = Math.min(n - 1, g0 + 1);
  const b1 = Math.min(n - 1, b0 + 1);

  const fr = r - r0;
  const fg = g - g0;
  const fb = b - b0;

  const c000 = lut.tabela[index(r0, g0, b0)];
  const c100 = lut.tabela[index(r1, g0, b0)];
  const c010 = lut.tabela[index(r0, g1, b0)];
  const c110 = lut.tabela[index(r1, g1, b0)];

  const c001 = lut.tabela[index(r0, g0, b1)];
  const c101 = lut.tabela[index(r1, g0, b1)];
  const c011 = lut.tabela[index(r0, g1, b1)];
  const c111 = lut.tabela[index(r1, g1, b1)];

  return [0, 1, 2].map(c => {
    const baixo =
      c000[c] * (1 - fr) * (1 - fg) +
      c100[c] * fr * (1 - fg) +
      c010[c] * (1 - fr) * fg +
      c110[c] * fr * fg;

    const alto =
      c001[c] * (1 - fr) * (1 - fg) +
      c101[c] * fr * (1 - fg) +
      c011[c] * (1 - fr) * fg +
      c111[c] * fr * fg;

    return baixo * (1 - fb) + alto * fb;
  });
}

function aplicarLUTAoFundo() {
  if (!lut || videoFundo.readyState < 2) return false;

  const largura = 240;
  const altura = Math.max(
    1,
    Math.round(largura * canvas.height / canvas.width)
  );

  fundoLUT.width = largura;
  fundoLUT.height = altura;

  fundoLUTctx.drawImage(videoFundo, 0, 0, largura, altura);

  let imagem;

  try {
    imagem = fundoLUTctx.getImageData(0, 0, largura, altura);
  } catch (erro) {
    return false;
  }

  const pixels = imagem.data;
  const n = lut.size;

  for (let i = 0; i < pixels.length; i += 4) {
    const canais = [
      pixels[i],
      pixels[i + 1],
      pixels[i + 2]
    ];

    const normalizados = canais.map((valor, canal) => {
      const minimo = lut.domainMin[canal];
      const maximo = lut.domainMax[canal];

      return limitar(
        (valor / 255 - minimo) / (maximo - minimo || 1),
        0,
        1
      ) * (n - 1);
    });

    const resultado = obterPontoLUT(
      normalizados[0],
      normalizados[1],
      normalizados[2]
    );

    pixels[i] = limitar(Math.round(resultado[0] * 255), 0, 255);
    pixels[i + 1] = limitar(Math.round(resultado[1] * 255), 0, 255);
    pixels[i + 2] = limitar(Math.round(resultado[2] * 255), 0, 255);
  }

  fundoLUTctx.putImageData(imagem, 0, 0);

  ctx.drawImage(fundoLUT, 0, 0, canvas.width, canvas.height);

  return true;
}

/* =========================================================
   FORMATOS DE PROJETO EXTERNO
========================================================= */

$("arquivoProjeto").addEventListener("change", event => {
  const arquivo = event.target.files[0];

  if (!arquivo) return;

  const extensao = arquivo.name.split(".").pop().toLowerCase();

  const programas = {
    mogrt: "modelo gráfico do Adobe Premiere Pro/After Effects",
    aep: "projeto do Adobe After Effects",
    drp: "projeto do DaVinci Resolve",
    setting: "arquivo de configuração de aplicativo",
    moef: "arquivo de efeito do Filmora",
    motn: "projeto ou modelo de movimento"
  };

  $("estadoProjeto").textContent =
    `${arquivo.name} — reconhecido como ${programas[extensao] || "arquivo externo"}.`;

  mensagem(
    "Este arquivo foi identificado, mas não pode ser convertido automaticamente em camadas editáveis neste editor. Exporte o resultado do programa original como vídeo para usá-lo como fundo."
  );
});

/* =========================================================
   ADESIVOS E IMAGENS
========================================================= */

$("arquivoImagem").addEventListener("change", event => {
  const arquivo = event.target.files[0];

  if (!arquivo) return;

  if (!arquivo.type.startsWith("image/")) {
    mensagem("Selecione uma imagem válida.");
    return;
  }

  const url = URL.createObjectURL(arquivo);
  const imagem = new Image();

  imagem.onload = () => {
    const escala = Math.min(
      canvas.width * 0.35 / imagem.width,
      canvas.height * 0.25 / imagem.height,
      1
    );

    const item = {
      id: ++contadorImagens,
      nome: arquivo.name,
      imagem,
      url,
      x: canvas.width / 2,
      y: canvas.height / 2,
      largura: Math.max(1, imagem.width * escala),
      altura: Math.max(1, imagem.height * escala),
      escala: 100,
      rotacao: 0
    };

    elementosVisuais.push(item);
    imagemSelecionada = item.id;

    $("nomeImagem").textContent = arquivo.name;
    $("estadoImagem").textContent =
      "Imagem adicionada. Arraste-a na prévia para posicionar.";

    $("tamanhoImagem").value = 100;
    $("rotacaoImagem").value = 0;

    definirTamanhoImagem();
    definirRotacaoImagem();

    renderizar();
    mensagem("Imagem adicionada ao vídeo.");
  };

  imagem.onerror = () => {
    URL.revokeObjectURL(url);
    mensagem("Não foi possível abrir esta imagem.");
  };

  imagem.src = url;
});

function itemImagemSelecionada() {
  return elementosVisuais.find(item => item.id === imagemSelecionada);
}

$("tamanhoImagem").addEventListener("input", () => {
  definirTamanhoImagem();

  const item = itemImagemSelecionada();

  if (item) {
    item.escala = Number($("tamanhoImagem").value);
    renderizar();
  }
});

$("rotacaoImagem").addEventListener("input", () => {
  definirRotacaoImagem();

  const item = itemImagemSelecionada();

  if (item) {
    item.rotacao = Number($("rotacaoImagem").value);
    renderizar();
  }
});

$("centralizarImagem").addEventListener("click", () => {
  const item = itemImagemSelecionada();

  if (!item) {
    mensagem("Selecione uma imagem primeiro.");
    return;
  }

  item.x = canvas.width / 2;
  item.y = canvas.height / 2;

  renderizar();
});

$("excluirImagem").addEventListener("click", () => {
  const item = itemImagemSelecionada();

  if (!item) {
    mensagem("Selecione uma imagem primeiro.");
    return;
  }

  elementosVisuais = elementosVisuais.filter(
    imagem => imagem.id !== item.id
  );

  URL.revokeObjectURL(item.url);

  imagemSelecionada = null;

  $("nomeImagem").textContent = "Nenhuma imagem selecionada";
  $("estadoImagem").textContent =
    "Você pode arrastar a imagem diretamente na prévia.";

  renderizar();
});

function obterCoordenadas(evento) {
  const retangulo = canvas.getBoundingClientRect();

  return {
    x: (evento.clientX - retangulo.left) * canvas.width / retangulo.width,
    y: (evento.clientY - retangulo.top) * canvas.height / retangulo.height
  };
}

function encontrarImagem(x, y) {
  for (let i = elementosVisuais.length - 1; i >= 0; i--) {
    const item = elementosVisuais[i];

    const dx = x - item.x;
    const dy = y - item.y;

    const angulo = -item.rotacao * Math.PI / 180;

    const rx = dx * Math.cos(angulo) - dy * Math.sin(angulo);
    const ry = dx * Math.sin(angulo) + dy * Math.cos(angulo);

    const escala = item.escala / 100;
    const largura = item.largura * escala;
    const altura = item.altura * escala;

    if (
      Math.abs(rx) <= largura / 2 &&
      Math.abs(ry) <= altura / 2
    ) {
      return item;
    }
  }

  return null;
}

canvas.addEventListener("pointerdown", evento => {
  const posicao = obterCoordenadas(evento);
  const item = encontrarImagem(posicao.x, posicao.y);

  if (item) {
    imagemSelecionada = item.id;
    arrastando = true;
    ultimaPosicao = posicao;

    canvas.setPointerCapture(evento.pointerId);

    $("nomeImagem").textContent = item.nome;
    $("tamanhoImagem").value = item.escala;
    $("rotacaoImagem").value = item.rotacao;

    definirTamanhoImagem();
    definirRotacaoImagem();

    $("estadoImagem").textContent = "Arrastando imagem selecionada.";
    renderizar();
  }
});

canvas.addEventListener("pointermove", evento => {
  if (!arrastando || !ultimaPosicao) return;

  const posicao = obterCoordenadas(evento);
  const item = itemImagemSelecionada();

  if (!item) return;

  item.x += posicao.x - ultimaPosicao.x;
  item.y += posicao.y - ultimaPosicao.y;

  ultimaPosicao = posicao;

  renderizar();
});

function encerrarArrasto() {
  arrastando = false;
  ultimaPosicao = null;
}

canvas.addEventListener("pointerup", encerrarArrasto);
canvas.addEventListener("pointercancel", encerrarArrasto);

canvas.addEventListener("pointerdown", evento => {
  const posicao = obterCoordenadas(evento);

  if (!encontrarImagem(posicao.x, posicao.y)) {
    imagemSelecionada = null;
    renderizar();
  }
});

/* =========================================================
   DESENHO DO TEXTO E EFEITOS
========================================================= */

function desenharTextoCentralizado(texto, x, y, tamanho, cor) {
  ctx.fillStyle = cor;
  ctx.fillText(texto, x, y);
}

function quebrarTexto(texto, larguraMaxima) {
  const palavras = String(texto).split(/\s+/);
  const linhas = [];
  let linha = "";

  for (const palavra of palavras) {
    const teste = linha ? linha + " " + palavra : palavra;

    if (ctx.measureText(teste).width > larguraMaxima && linha) {
      linhas.push(linha);
      linha = palavra;
    } else {
      linha = teste;
    }
  }

  if (linha) linhas.push(linha);

  return linhas;
}

function desenharLegenda(legenda, tempo) {
  if (!legenda || !legenda.texto) return;

  const largura = canvas.width;
  const altura = canvas.height;

  const tamanhoBase =
    Number($("tamanhoTexto").value) * largura / 720;

  const fonteSelecionada = $("fonteTexto").value;
  const familia = fonteSelecionada === "custom"
    ? (fontePersonalizada || "Arial")
    : fonteSelecionada;

  const animacao = $("animacaoTexto").value;
  const efeito = $("efeitoTexto").value;

  const corTexto = corValida($("corTexto").value, "#ffffff");
  const corDestaque = corValida($("corDestaque").value, "#72f0b0");
  const corEfeito = corValida($("corEfeito").value, "#000000");

  const duracaoLegenda = Math.max(0.01, legenda.fim - legenda.inicio);
  const progresso = limitar(
    (tempo - legenda.inicio) / duracaoLegenda,
    0,
    1
  );

  const tempoEntrada = Math.max(0, tempo - legenda.inicio);

  let opacidade = 1;
  let deslocamentoY = 0;
  let escala = 1;

  if (animacao === "fade") {
    opacidade = limitar(tempoEntrada / 0.45, 0, 1);
  } else if (animacao === "slide") {
    opacidade = limitar(tempoEntrada / 0.35, 0, 1);
    deslocamentoY = (1 - opacidade) * tamanhoBase * 1.5;
  } else if (animacao === "scale") {
    const p = limitar(tempoEntrada / 0.4, 0, 1);
    escala = 0.75 + 0.25 * p;
    opacidade = p;
  }

  let texto = legenda.texto;

  if (animacao === "typewriter") {
    const quantidade = Math.max(
      1,
      Math.floor(texto.length * limitar(tempoEntrada / 1.8, 0, 1))
    );

    texto = texto.slice(0, quantidade);
  }

  const larguraMaxima = largura * 0.86;

  ctx.save();
  ctx.globalAlpha = opacidade;
  ctx.translate(largura / 2, 0);
  ctx.translate(0, deslocamentoY);
  ctx.scale(escala, escala);

  ctx.font = `800 ${tamanhoBase}px "${familia}"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  const linhas = quebrarTexto(texto, larguraMaxima);
  const alturaLinha = tamanhoBase * 1.25;
  const alturaTotal = linhas.length * alturaLinha;

  let centroY;

  if ($("posicaoTexto").value === "alto") {
    centroY = altura * 0.19;
  } else if ($("posicaoTexto").value === "centro") {
    centroY = altura * 0.5;
  } else {
    centroY = altura * 0.77;
  }

  let yInicial = centroY - alturaTotal / 2 + alturaLinha / 2;

  if (efeito === "shadow") {
    ctx.shadowColor = corEfeito;
    ctx.shadowBlur = Number($("intensidadeEfeito").value) * largura / 720;
    ctx.shadowOffsetX = 2 * largura / 720;
    ctx.shadowOffsetY = 4 * largura / 720;
  } else if (efeito === "glow" || efeito === "neon") {
    ctx.shadowColor = efeito === "neon" ? corDestaque : corEfeito;
    ctx.shadowBlur = Number($("intensidadeEfeito").value) * largura / 720;
  }

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    const y = yInicial + i * alturaLinha;

    if (efeito === "outline") {
      ctx.lineWidth = Math.max(2, tamanhoBase * 0.09);
      ctx.strokeStyle = corEfeito;
      ctx.strokeText(linha, 0, y, larguraMaxima);
    }

    if (efeito === "neon") {
      ctx.lineWidth = Math.max(1, tamanhoBase * 0.025);
      ctx.strokeStyle = corDestaque;
      ctx.strokeText(linha, 0, y, larguraMaxima);
    }

    if (animacao === "highlight") {
      const proporcao = limitar(progresso * 1.4, 0, 1);
      const medida = ctx.measureText(linha).width;
      const inicio = -medida / 2;
      const limiteDestaque = inicio + medida * proporcao;

      ctx.fillStyle = corTexto;
      ctx.fillText(linha, 0, y, larguraMaxima);

      ctx.save();
      ctx.beginPath();
      ctx.rect(
        inicio - 2,
        y - alturaLinha / 2,
        Math.max(0, limiteDestaque - inicio + 2),
        alturaLinha
      );
      ctx.clip();

      ctx.fillStyle = corDestaque;
      ctx.fillText(linha, 0, y, larguraMaxima);
      ctx.restore();
    } else {
      ctx.fillStyle = corTexto;
      desenharTextoCentralizado(linha, 0, y, tamanhoBase, corTexto);
    }
  }

  ctx.restore();
}

/* =========================================================
   VISUALIZADOR DE ÁUDIO
========================================================= */

function desenharVisualizador() {
  if (!$("mostrarAudio").checked) return;

  const largura = canvas.width;
  const altura = canvas.height;
  const quantidade = 42;
  const areaLargura = largura * 0.72;
  const larguraBarra = areaLargura / quantidade * 0.58;
  const espacamento = areaLargura / quantidade;
  const inicioX = (largura - areaLargura) / 2;
  const baseY = altura * 0.91;
  const cor = corValida($("corDestaque").value, "#72f0b0");

  if (analisador && dadosAudio) {
    analisador.getByteFrequencyData(dadosAudio);
  }

  ctx.save();
  ctx.fillStyle = cor;
  ctx.globalAlpha = 0.8;

  for (let i = 0; i < quantidade; i++) {
    let valor;

    if (dadosAudio) {
      const indice = Math.floor(
        i * dadosAudio.length / quantidade
      );

      valor = dadosAudio[indice] / 255;
    } else {
      valor = 0.08;
    }

    const barraAltura = Math.max(
      3,
      valor * altura * 0.08
    );

    const x = inicioX + i * espacamento;

    ctx.beginPath();
    ctx.roundRect(
      x,
      baseY - barraAltura,
      larguraBarra,
      barraAltura,
      Math.min(5, larguraBarra / 2)
    );
    ctx.fill();
  }

  ctx.restore();
}

/* =========================================================
   RENDERIZAÇÃO DO CANVAS
========================================================= */

function desenharFundo() {
  const largura = canvas.width;
  const altura = canvas.height;

  ctx.fillStyle = corValida($("corFundo").value, "#101522");
  ctx.fillRect(0, 0, largura, altura);

  if (videoFundo.readyState < 2 || !videoFundo.videoWidth) {
    return;
  }

  if (lut) {
    try {
      if (aplicarLUTAoFundo()) return;
    } catch (erro) {
      console.error("Erro ao aplicar LUT:", erro);
    }
  }

  const escala = Math.max(
    largura / videoFundo.videoWidth,
    altura / videoFundo.videoHeight
  );

  const w = videoFundo.videoWidth * escala;
  const h = videoFundo.videoHeight * escala;

  ctx.drawImage(
    videoFundo,
    (largura - w) / 2,
    (altura - h) / 2,
    w,
    h
  );
}

function desenharAdesivos() {
  elementosVisuais.forEach(item => {
    if (!item.imagem.complete) return;

    const escala = item.escala / 100;
    const largura = item.largura * escala;
    const altura = item.altura * escala;

    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.rotate(item.rotacao * Math.PI / 180);

    ctx.drawImage(
      item.imagem,
      -largura / 2,
      -altura / 2,
      largura,
      altura
    );

    if (!exportando && item.id === imagemSelecionada) {
      ctx.strokeStyle = "#72f0b0";
      ctx.lineWidth = Math.max(1, canvas.width / 720);
      ctx.setLineDash([7, 5]);

      ctx.strokeRect(
        -largura / 2,
        -altura / 2,
        largura,
        altura
      );

      ctx.setLineDash([]);
    }

    ctx.restore();
  });
}

function renderizar() {
  const tempo = audio.currentTime || 0;

  desenharFundo();

  const legenda = linhaAtiva(tempo);

  desenharVisualizador();

  if (legenda) {
    desenharLegenda(legenda, tempo);
  }

  desenharAdesivos();

  if (!exportando && !audio.src && !videoFundo.src && !legendas.length) {
    ctx.save();

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.font = `800 ${canvas.width * 0.065}px Arial`;
    ctx.fillText("LYRIC STUDIO", canvas.width / 2, canvas.height / 2 - 20);

    ctx.fillStyle = "#91a0b1";
    ctx.font = `${canvas.width * 0.023}px Arial`;
    ctx.fillText(
      "Importe uma música para começar",
      canvas.width / 2,
      canvas.height / 2 + 25
    );

    ctx.restore();
  }
}

/* =========================================================
   CONTROLES DE APARÊNCIA
========================================================= */

[
  "formato",
  "resolucao"
].forEach(id => {
  $(id).addEventListener("change", definirFormato);
});

[
  "posicaoTexto",
  "corFundo",
  "corTexto",
  "corDestaque",
  "fonteTexto",
  "animacaoTexto",
  "efeitoTexto",
  "corEfeito",
  "intensidadeEfeito",
  "mostrarAudio"
].forEach(id => {
  $(id).addEventListener("input", renderizar);
  $(id).addEventListener("change", renderizar);
});

$("tamanhoTexto").addEventListener("input", () => {
  definirTamanhoTexto();
  renderizar();
});

/* =========================================================
   EXPORTAÇÃO DE VÍDEO
========================================================= */

function obterTipoGravacao() {
  if (!window.MediaRecorder) return null;

  const tipos = [
    "video/mp4;codecs=avc1",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];

  return tipos.find(tipo => MediaRecorder.isTypeSupported(tipo)) || "";
}

function encerrarExportacao() {
  exportando = false;

  $("exportar").disabled = false;
  $("pararExportacao").disabled = true;

  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  renderizar();
}

$("exportar").addEventListener("click", async () => {
  if (!window.MediaRecorder || !canvas.captureStream) {
    mensagem(
      "Este navegador não oferece suporte à exportação de vídeo necessária."
    );
    return;
  }

  if (exportando) {
    mensagem("Já existe uma exportação em andamento.");
    return;
  }

  if (!audio.src) {
    mensagem("Importe um áudio antes de exportar o vídeo.");
    return;
  }

  if (!obterDuracao()) {
    mensagem("Aguarde o carregamento da duração do áudio.");
    return;
  }

  const tipo = obterTipoGravacao();

  if (tipo === null) {
    mensagem("O navegador não oferece suporte ao MediaRecorder.");
    return;
  }

  prepararAudioContext();

  if (audioContext && audioContext.state === "suspended") {
    await audioContext.resume();
  }

  const streamVideo = canvas.captureStream(30);
  const faixasAudio = audioDestination
    ? audioDestination.stream.getAudioTracks()
    : [];

  faixasAudio.forEach(faixa => streamVideo.addTrack(faixa));

  partesVideo = [];

  const opcoes = {};

  if (tipo) {
    opcoes.mimeType = tipo;
  }

  if ($("qualidade").value === "high") {
    opcoes.videoBitsPerSecond = 8_000_000;
    opcoes.audioBitsPerSecond = 192_000;
  } else {
    opcoes.videoBitsPerSecond = 4_000_000;
    opcoes.audioBitsPerSecond = 128_000;
  }

  try {
    mediaRecorder = new MediaRecorder(streamVideo, opcoes);
  } catch (erro) {
    streamVideo.getTracks().forEach(track => track.stop());
    mensagem("Não foi possível iniciar a gravação neste navegador.");
    return;
  }

  mediaRecorder.ondataavailable = event => {
    if (event.data && event.data.size > 0) {
      partesVideo.push(event.data);
    }
  };

  mediaRecorder.onerror = event => {
    console.error(event.error || event);
    mensagem("Ocorreu um erro durante a exportação.");
    encerrarExportacao();
  };

  mediaRecorder.onstop = () => {
    const mimeType = mediaRecorder.mimeType || tipo || "video/webm";

    const extensao = mimeType.includes("mp4") ? "mp4" : "webm";

    const blob = new Blob(partesVideo, { type: mimeType });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `lyric-studio-${Date.now()}.${extensao}`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 60_000);

    streamVideo.getTracks().forEach(track => track.stop());

    if (audio.paused === false) {
      audio.pause();
    }

    if (videoFundo.src) {
      videoFundo.pause();
    }

    encerrarExportacao();

    mensagem(
      `Exportação concluída. Arquivo gerado: ${extensao.toUpperCase()}.`
    );
  };

  exportando = true;

  $("exportar").disabled = true;
  $("pararExportacao").disabled = false;

  audio.currentTime = 0;

  if (videoFundo.src) {
    try {
      videoFundo.currentTime = 0;
      await videoFundo.play();
    } catch (erro) {
      console.warn("O vídeo de fundo não iniciou automaticamente.", erro);
    }
  }

  renderizar();
  mediaRecorder.start(250);

  try {
    await audio.play();

    mensagem(
      `Exportando vídeo em ${canvas.width} × ${canvas.height}. Não feche a página.`
    );
  } catch (erro) {
    if (mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }

    mensagem("Não foi possível iniciar a reprodução do áudio para exportar.");
    return;
  }

  function acompanharExportacao() {
    if (!exportando) return;

    renderizar();

    if (audio.ended || audio.currentTime >= obterDuracao()) {
      if (mediaRecorder?.state === "recording") {
        mediaRecorder.stop();
      }
      return;
    }

    rafId = requestAnimationFrame(acompanharExportacao);
  }

  rafId = requestAnimationFrame(acompanharExportacao);
});

$("pararExportacao").addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    mensagem("Finalizando a exportação...");
  }
});

/* =========================================================
   INICIALIZAÇÃO
========================================================= */

definirTamanhoTexto();
definirTamanhoImagem();
definirRotacaoImagem();
definirFormato();
atualizarTempo();
atualizarSeletorLegendas();
desenharLista();

function loopPrevia() {
  renderizar();
  requestAnimationFrame(loopPrevia);
}

loopPrevia();

window.addEventListener("beforeunload", () => {
  if (audioURL) URL.revokeObjectURL(audioURL);
  if (videoURL) URL.revokeObjectURL(videoURL);
  if (fonteURL) URL.revokeObjectURL(fonteURL);

  elementosVisuais.forEach(item => {
    if (item.url) URL.revokeObjectURL(item.url);
  });
});