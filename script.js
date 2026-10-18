"use strict";

/* =========================================================
   LYRIC STUDIO
   Áudio, legendas, fontes, animações, efeitos, vídeos,
   LUT .CUBE, adesivos e exportação
========================================================= */

const $ = id => document.getElementById(id);

/* Liga um evento só se o elemento existir, para um HTML desatualizado
   não derrubar o resto do editor. */
function ligar(id, evento, funcao, opcoes) {
  const elemento = document.getElementById(id);
  if (elemento) elemento.addEventListener(evento, funcao, opcoes);
}

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

/* Identifica o ponteiro usado no arraste. */
let ponteiroArrasteId = null;

const fundoLUT = document.createElement("canvas");
const fundoLUTctx = fundoLUT.getContext("2d", {
  willReadFrequently: true
});

/* =========================================================
   UTILITÁRIOS
========================================================= */

function mensagem(texto) {
  $("mensagem").textContent = texto;
}

function formatarTempo(segundos) {
  if (!Number.isFinite(segundos) || segundos < 0) segundos = 0;

  const minutos = Math.floor(segundos / 60);
  const segundosRestantes = Math.floor(segundos % 60);

  return String(minutos).padStart(2, "0") + ":" +
    String(segundosRestantes).padStart(2, "0");
}

function tempoParaCampo(segundos) {
  if (!Number.isFinite(segundos) || segundos < 0) segundos = 0;

  const horas = Math.floor(segundos / 3600);
  const minutos = Math.floor((segundos % 3600) / 60);
  const segundosRestantes = segundos % 60;

  return String(horas).padStart(2, "0") + ":" +
    String(minutos).padStart(2, "0") + ":" +
    segundosRestantes.toFixed(2).padStart(5, "0");
}

function campoParaTempo(valor) {
  if (typeof valor === "number") return Math.max(0, valor);

  const texto = String(valor || "").trim();
  if (!texto) return 0;

  if (/^\d+([.,]\d+)?$/.test(texto)) {
    return Math.max(0, Number(texto.replace(",", ".")) || 0);
  }

  const partes = texto.split(":").map(Number);

  if (partes.some(n => !Number.isFinite(n)) || partes.length > 3) {
    return 0;
  }

  if (partes.length === 3) {
    return Math.max(0, partes[0] * 3600 + partes[1] * 60 + partes[2]);
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
  $("valorTamanhoImagem").textContent = $("tamanhoImagem").value + "%";
}

function definirRotacaoImagem() {
  $("valorRotacaoImagem").textContent = $("rotacaoImagem").value + "°";
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

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

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

    mensagem("Áudio pronto. Abra as Ondas para colocar as legendas na música.");
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
  audio.currentTime = Math.min(obterDuracao() || Infinity, audio.currentTime + 5);
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
    mensagem("O navegador não conseguiu abrir este áudio. Tente outro formato.");
  }
});

/* =========================================================
   LETRA COM TEMPOS
   As legendas sem tempo são criadas dentro das Ondas.
========================================================= */

/* ---------------------------------------------------------
   COLAR LETRA COM TEMPOS
   Formatos aceitos por linha:
   00:12 Texto             [01:23.50] Texto (LRC)
   00:12 - 00:15 Texto     1:02:03 Texto
--------------------------------------------------------- */

const TEMPO_REGEX = "(\\d{1,2}(?::\\d{1,2}){1,2}(?:[.,]\\d{1,3})?)";

const LINHA_COM_TEMPO = new RegExp(
  "^\\s*[\\[\\(]?" + TEMPO_REGEX + "[\\]\\)]?" +
  "(?:\\s*(?:->|-|–|—)\\s*[\\[\\(]?" + TEMPO_REGEX + "[\\]\\)]?)?" +
  "\\s*[-–—|]?\\s*(.*)$"
);

function lerLetraComTempos(conteudo) {
  const entradas = [];
  let ignoradas = 0;

  conteudo.split(/\r?\n/).forEach(linhaOriginal => {
    const linha = linhaOriginal.trim();
    if (!linha) return;

    const resultado = LINHA_COM_TEMPO.exec(linha);

    if (!resultado) {
      ignoradas++;
      return;
    }

    entradas.push({
      inicio: campoParaTempo(resultado[1].replace(",", ".")),
      fimExplicito: resultado[2]
        ? campoParaTempo(resultado[2].replace(",", "."))
        : null,
      texto: (resultado[3] || "").trim()
    });
  });

  /* Ordena pelo tempo de início, preservando a ordem em caso de empate. */
  entradas
    .map((entrada, posicao) => ({ entrada, posicao }))
    .sort((a, b) => a.entrada.inicio - b.entrada.inicio || a.posicao - b.posicao)
    .forEach((item, posicao) => { entradas[posicao] = item.entrada; });

  const duracao = obterDuracao();
  const resultadoFinal = [];

  entradas.forEach((entrada, i) => {
    /* Linha só com o tempo funciona como marcador de saída da anterior. */
    if (!entrada.texto) return;

    let fim = entrada.fimExplicito;

    if (fim === null || fim <= entrada.inicio) {
      const proxima = entradas[i + 1];

      if (proxima && proxima.inicio > entrada.inicio) {
        fim = proxima.inicio;
      } else if (!proxima) {
        fim = entrada.inicio + 4;
        if (duracao > entrada.inicio) fim = Math.min(fim, duracao);
      } else {
        fim = entrada.inicio + 0.5;
      }
    }

    if (fim <= entrada.inicio) fim = entrada.inicio + 0.5;

    resultadoFinal.push({
      id: crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now() + resultadoFinal.length),
      texto: entrada.texto,
      linha: resultadoFinal.length + 1,
      parte: false,
      inicio: entrada.inicio,
      fim,
      naOnda: true
    });
  });

  return { legendas: resultadoFinal, ignoradas };
}

ligar("criarLinhasComTempos", "click", () => {
  const conteudo = $("letraComTempos").value.trim();

  if (!conteudo) {
    mensagem("Cole a letra com os tempos antes de criar as legendas.");
    return;
  }

  const { legendas: novas, ignoradas } = lerLetraComTempos(conteudo);

  if (!novas.length) {
    mensagem("Nenhuma linha com tempo foi encontrada. Use o formato 00:12 Texto da linha.");
    return;
  }

  legendas = novas;
  indiceSelecionado = 0;

  atualizarContador();
  renderizar();

  mensagem(
    novas.length + (novas.length === 1 ? " legenda criada" : " legendas criadas") +
    " com os tempos colados." +
    (ignoradas ? " " + ignoradas + (ignoradas === 1 ? " linha sem tempo foi ignorada." : " linhas sem tempo foram ignoradas.") : "")
  );
});

/* =========================================================
   ÁUDIO DECODIFICADO (usado pela forma de onda)
========================================================= */

let _audioBufferCache = null;
let _audioBufferSrc = null;

async function carregarAudioBuffer() {
  if (!audio.src) throw new Error("Importe o áudio antes de abrir as Ondas.");
  if (_audioBufferCache && _audioBufferSrc === audio.src) return _audioBufferCache;

  /* OfflineAudioContext exige parâmetros; o AudioContext comum decodifica sem eles. */
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const acTemp = AudioContextClass
    ? new AudioContextClass()
    : new OfflineAudioContext(1, 1, 44100);
  try {
    const resp = await fetch(audio.src);
    const ab = await resp.arrayBuffer();
    _audioBufferCache = await acTemp.decodeAudioData(ab);
    _audioBufferSrc = audio.src;
    return _audioBufferCache;
  } finally {
    try { acTemp.close(); } catch (_) {}
  }
}

/* =========================================================
   LEGENDAS NA PRÉVIA
   Só entram no vídeo as legendas que já foram colocadas na onda.
========================================================= */

function atualizarContador() {
  const campo = $("contadorLegendas");
  if (!campo) return;

  const total = legendas.length;
  const naOnda = legendas.filter(l => l.naOnda === true).length;

  campo.textContent =
    total + (total === 1 ? " legenda" : " legendas") + " · " + naOnda + " na onda";
}

function linhaAtiva(tempo) {
  return legendas.find(legenda =>
    legenda.naOnda === true && tempo >= legenda.inicio && tempo < legenda.fim
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
    if (fonteURL) URL.revokeObjectURL(fonteURL);

    fonteURL = URL.createObjectURL(arquivo);

    const nomeInterno = "FonteLyricCustom";
    const face = new FontFace(nomeInterno, `url("${fonteURL}")`);

    await face.load();
    document.fonts.add(face);
    fontePersonalizada = nomeInterno;

    const opcao = [...$("fonteTexto").options].find(item => item.value === "custom");
    if (opcao) opcao.textContent = arquivo.name;

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

  if (videoURL) URL.revokeObjectURL(videoURL);

  videoFundo.pause();
  videoURL = URL.createObjectURL(arquivo);
  videoFundo.src = videoURL;
  videoFundo.load();

  $("nomeVideo").textContent = arquivo.name;

  videoFundo.onloadeddata = () => {
    videoFundo.currentTime = 0;
    videoFundo.play().catch(() => {
      mensagem("Vídeo carregado. Clique em Reproduzir fundo para iniciar.");
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
    const linha = linhaOriginal.replace(/#.*/, "").trim();
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

    if (["LUT_1D_SIZE", "LUT_1D_INPUT_RANGE", "LUT_1D_OUTPUT_RANGE"].includes(comando)) {
      throw new Error("Esta ferramenta aceita LUT 3D. Exporte a LUT como .CUBE 3D.");
    }

    if (partes.length >= 3) {
      const valores = partes.slice(0, 3).map(Number);
      if (valores.every(Number.isFinite)) tabela.push(valores);
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

  return { size: tamanho, domainMin, domainMax, tabela };
}

$("arquivoLUT").addEventListener("change", async event => {
  const arquivo = event.target.files[0];
  if (!arquivo) return;

  try {
    lut = analisarLUT(await arquivo.text());
    $("nomeLUT").textContent = `${arquivo.name} — LUT 3D ${lut.size}³ carregada`;
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
  const index = (ri, gi, bi) => bi * n * n + gi * n + ri;

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
  const altura = Math.max(1, Math.round(largura * canvas.height / canvas.width));

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
    const canais = [pixels[i], pixels[i + 1], pixels[i + 2]];

    const normalizados = canais.map((valor, canal) => {
      const minimo = lut.domainMin[canal];
      const maximo = lut.domainMax[canal];

      return limitar((valor / 255 - minimo) / (maximo - minimo || 1), 0, 1) * (n - 1);
    });

    const resultado = obterPontoLUT(normalizados[0], normalizados[1], normalizados[2]);

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
      rotacao: 0,
      animacao: {
        entrada: "none",
        loop: "none",
        saida: "none",
        inicio: 0,
        fim: 0,
        velocidade: 1
      }
    };

    elementosVisuais.push(item);
    imagemSelecionada = item.id;

    $("nomeImagem").textContent = arquivo.name;
    $("estadoImagem").textContent = "Imagem adicionada. Arraste-a na prévia para posicionar.";

    $("tamanhoImagem").value = 100;
    $("rotacaoImagem").value = 0;

    definirTamanhoImagem();
    definirRotacaoImagem();

    if (typeof window.carregarControlesAnimacaoAdesivo === "function") {
      window.carregarControlesAnimacaoAdesivo(item);
    }

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

  elementosVisuais = elementosVisuais.filter(imagem => imagem.id !== item.id);
  URL.revokeObjectURL(item.url);
  imagemSelecionada = null;

  $("nomeImagem").textContent = "Nenhuma imagem selecionada";
  $("estadoImagem").textContent = "Você pode arrastar a imagem diretamente na prévia.";

  if (typeof window.carregarControlesAnimacaoAdesivo === "function") {
    window.carregarControlesAnimacaoAdesivo(null);
  }

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

    if (Math.abs(rx) <= largura / 2 && Math.abs(ry) <= altura / 2) {
      return item;
    }
  }

  return null;
}

/* =========================================================
   ARRASTE CONTÍNUO DE ADESIVOS — CELULAR E COMPUTADOR
========================================================= */

canvas.style.touchAction = "none";
canvas.style.userSelect = "none";
canvas.style.webkitUserSelect = "none";
canvas.style.webkitTouchCallout = "none";

function iniciarArrasto(evento) {
  if (!evento.isPrimary) return;

  if (evento.pointerType === "mouse" && evento.button !== 0) {
    return;
  }

  const posicao = obterCoordenadas(evento);
  const item = encontrarImagem(posicao.x, posicao.y);

  if (!item) {
    imagemSelecionada = null;

    if (typeof window.carregarControlesAnimacaoAdesivo === "function") {
      window.carregarControlesAnimacaoAdesivo(null);
    }

    renderizar();
    return;
  }

  evento.preventDefault();

  imagemSelecionada = item.id;
  arrastando = true;
  ultimaPosicao = posicao;
  ponteiroArrasteId = evento.pointerId;

  try {
    canvas.setPointerCapture(evento.pointerId);
  } catch (erro) {
    console.warn("Não foi possível capturar o ponteiro:", erro);
  }

  $("nomeImagem").textContent = item.nome;
  $("tamanhoImagem").value = item.escala;
  $("rotacaoImagem").value = item.rotacao;

  definirTamanhoImagem();
  definirRotacaoImagem();

  if (typeof window.carregarControlesAnimacaoAdesivo === "function") {
    window.carregarControlesAnimacaoAdesivo(item);
  }

  $("estadoImagem").textContent =
    "Mantenha o dedo pressionado e deslize para mover o adesivo.";

  renderizar();
}

function moverArrasto(evento) {
  if (!arrastando || !ultimaPosicao) return;
  if (evento.pointerId !== ponteiroArrasteId) return;

  evento.preventDefault();

  const item = itemImagemSelecionada();

  if (!item) {
    encerrarArrasto(evento);
    return;
  }

  const posicao = obterCoordenadas(evento);

  item.x += posicao.x - ultimaPosicao.x;
  item.y += posicao.y - ultimaPosicao.y;

  ultimaPosicao = posicao;

  renderizar();
}

function encerrarArrasto(evento) {
  if (
    evento &&
    ponteiroArrasteId !== null &&
    evento.pointerId !== ponteiroArrasteId
  ) {
    return;
  }

  const ponteiroAnterior = ponteiroArrasteId;

  arrastando = false;
  ultimaPosicao = null;
  ponteiroArrasteId = null;

  if (
    ponteiroAnterior !== null &&
    canvas.hasPointerCapture &&
    canvas.hasPointerCapture(ponteiroAnterior)
  ) {
    try {
      canvas.releasePointerCapture(ponteiroAnterior);
    } catch (erro) {
      // O navegador pode já ter liberado a captura.
    }
  }
}

canvas.addEventListener("pointerdown", iniciarArrasto, {
  passive: false
});

canvas.addEventListener("pointermove", moverArrasto, {
  passive: false
});

canvas.addEventListener("pointerup", encerrarArrasto);
canvas.addEventListener("pointercancel", encerrarArrasto);
canvas.addEventListener("lostpointercapture", encerrarArrasto);

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

/* =========================================================
   ANIMAÇÕES DO TEXTO (nativas e importadas)
   Toda animação é um "preset": modo, duração, suavização e
   keyframes (t de 0 a 1; opacity, x, y em tamanhos de fonte,
   scale e rotate em graus).
   modo: linha (linha inteira), palavra (uma palavra por vez,
   a anterior some) ou acumular (palavras surgem e ficam).
========================================================= */

const EASINGS = {
  linear: t => t,
  easeOut: t => 1 - Math.pow(1 - t, 3),
  easeInOut: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: t => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  bounce: t => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) { t -= 1.5 / d1; return n1 * t * t + 0.75; }
    if (t < 2.5 / d1) { t -= 2.25 / d1; return n1 * t * t + 0.9375; }
    t -= 2.625 / d1;
    return n1 * t * t + 0.984375;
  }
};

const ESTADO_NEUTRO = { opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 };

function numeroOu(valor, padrao) {
  if (valor === undefined || valor === null || valor === "") return padrao;
  const n = Number(valor);
  return Number.isFinite(n) ? n : padrao;
}

function normalizarPresetAnimacao(bruto) {
  if (!bruto || typeof bruto !== "object") return null;

  const lista = Array.isArray(bruto.keyframes) ? bruto.keyframes : null;
  if (!lista || lista.length < 2) return null;

  const modoBruto = String(bruto.modo ?? bruto.mode ?? "linha").toLowerCase();
  let modo = "linha";
  if (["palavra", "word"].includes(modoBruto)) modo = "palavra";
  if (["acumular", "build", "wordbuild"].includes(modoBruto)) modo = "acumular";

  const keyframes = lista
    .filter(k => k && typeof k === "object")
    .map(k => ({
      t: limitar(numeroOu(k.t, 0), 0, 1),
      opacity: numeroOu(k.opacity ?? k.opacidade, 1),
      x: numeroOu(k.x, 0),
      y: numeroOu(k.y, 0),
      scale: numeroOu(k.scale ?? k.escala, 1),
      rotate: numeroOu(k.rotate ?? k.rotacao, 0)
    }))
    .sort((a, b) => a.t - b.t);

  if (keyframes.length < 2) return null;

  const easing = String(bruto.easing ?? "linear");

  return {
    nome: String(bruto.nome ?? bruto.name ?? "Animação importada").slice(0, 40),
    modo,
    duracao: limitar(numeroOu(bruto.duracao ?? bruto.duration, 0.5), 0.05, 5),
    easing: EASINGS[easing] ? easing : "linear",
    keyframes
  };
}

const ANIMACOES_TEXTO = {
  fade: normalizarPresetAnimacao({
    duracao: 0.45,
    keyframes: [{ t: 0, opacity: 0 }, { t: 1, opacity: 1 }]
  }),
  slide: normalizarPresetAnimacao({
    duracao: 0.35,
    keyframes: [{ t: 0, opacity: 0, y: 1.5 }, { t: 1, opacity: 1, y: 0 }]
  }),
  scale: normalizarPresetAnimacao({
    duracao: 0.4,
    keyframes: [{ t: 0, opacity: 0, scale: 0.75 }, { t: 1, opacity: 1, scale: 1 }]
  }),
  bounce: normalizarPresetAnimacao({
    duracao: 0.55,
    easing: "back",
    keyframes: [{ t: 0, opacity: 0, scale: 0.3 }, { t: 1, opacity: 1, scale: 1 }]
  }),
  drop: normalizarPresetAnimacao({
    duracao: 0.7,
    easing: "bounce",
    keyframes: [{ t: 0, opacity: 0, y: -2.2 }, { t: 1, opacity: 1, y: 0 }]
  }),
  word: normalizarPresetAnimacao({
    modo: "palavra",
    duracao: 0.16,
    easing: "back",
    keyframes: [{ t: 0, opacity: 0, scale: 0.7 }, { t: 1, opacity: 1, scale: 1 }]
  }),
  wordBuild: normalizarPresetAnimacao({
    modo: "acumular",
    duracao: 0.22,
    easing: "easeOut",
    keyframes: [{ t: 0, opacity: 0, y: 0.5 }, { t: 1, opacity: 1, y: 0 }]
  })
};

let animacaoTextoImportada = null;

/* Palavras da legenda e onde cada uma começa. Os limites são frações (0 a 1)
   da duração da legenda; se não houver marcação manual, usa o tamanho das palavras. */
function palavrasDaLegenda(texto) {
  return String(texto || "").split(/\s+/).filter(Boolean);
}

function limitesPalavrasPadrao(texto) {
  const pesos = palavrasDaLegenda(texto).map(p => Math.max(2, p.length) + 1);
  const total = pesos.reduce((soma, peso) => soma + peso, 0);
  const limites = [];
  let acumulado = 0;

  for (let i = 0; i < pesos.length - 1; i++) {
    acumulado += pesos[i];
    limites.push(acumulado / total);
  }

  return limites;
}

function limitesPalavrasValidos(legenda) {
  const quantidade = palavrasDaLegenda(legenda && legenda.texto).length;
  const limites = legenda && legenda.limitesPalavras;

  return quantidade > 1 &&
    Array.isArray(limites) &&
    limites.length === quantidade - 1 &&
    limites.every((v, i) => Number.isFinite(v) && v > 0 && v < 1 && (i === 0 || v > limites[i - 1]));
}

function limitesPalavrasDaLegenda(legenda) {
  return limitesPalavrasValidos(legenda)
    ? legenda.limitesPalavras
    : limitesPalavrasPadrao(legenda.texto);
}

function obterPresetAnimacao(nome) {
  if (nome === "importada") return animacaoTextoImportada;
  return ANIMACOES_TEXTO[nome] || null;
}

function estadoAnimacaoTexto(preset, p) {
  const kf = preset.keyframes;
  const primeiro = kf[0];
  const ultimo = kf[kf.length - 1];

  if (p <= primeiro.t) return { ...primeiro };
  if (p >= ultimo.t) return { ...ultimo };

  const suavizar = EASINGS[preset.easing] || EASINGS.linear;

  for (let i = 0; i < kf.length - 1; i++) {
    const a = kf[i];
    const b = kf[i + 1];

    if (p >= a.t && p <= b.t) {
      const e = suavizar((p - a.t) / Math.max(1e-6, b.t - a.t));
      const mistura = (u, v) => u + (v - u) * e;

      return {
        opacity: mistura(a.opacity, b.opacity),
        x: mistura(a.x, b.x),
        y: mistura(a.y, b.y),
        scale: mistura(a.scale, b.scale),
        rotate: mistura(a.rotate, b.rotate)
      };
    }
  }

  return { ...ultimo };
}

/* ---------- Importar / baixar modelo / remover ---------- */

const MODELO_ANIMACAO_TEXTO = {
  nome: "Minha animação",
  ajuda: "modo: linha | palavra | acumular. easing: linear | easeOut | easeInOut | back | bounce. " +
    "Em keyframes, t vai de 0 a 1; x e y são em tamanhos de fonte; scale é multiplicador; rotate é em graus.",
  modo: "palavra",
  duracao: 0.25,
  easing: "back",
  keyframes: [
    { t: 0, opacity: 0, x: 0, y: 0.4, scale: 0.6, rotate: -8 },
    { t: 1, opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 }
  ]
};

/* Velocidade da animação: 0% = 4x mais lenta, 50% = normal, 100% = 4x mais rápida. */
function velocidadeAnimacaoTexto() {
  const campo = $("velocidadeAnimTexto");
  const percentual = campo ? limitar(numeroOu(campo.value, 50), 0, 100) : 50;
  return 0.25 * Math.pow(16, percentual / 100);
}

function sincronizarVelocidadeAnimacao(origem) {
  const barra = $("velocidadeAnimTexto");
  const numero = $("velocidadeAnimTextoNum");
  const rotulo = $("velocidadeAnimTextoRotulo");

  if (!barra || !numero || !rotulo) {
    renderizar();
    return;
  }

  let valor = numeroOu(origem.value, 50);
  valor = limitar(Math.round(valor), 0, 100);

  if (origem === barra) numero.value = valor;
  else barra.value = valor;

  rotulo.textContent = valor + "%" + (valor === 50 ? " (normal)" : "");
  renderizar();
}

ligar("velocidadeAnimTexto", "input", e => sincronizarVelocidadeAnimacao(e.target));
ligar("velocidadeAnimTextoNum", "input", e => {
  if (e.target.value === "") return;
  sincronizarVelocidadeAnimacao(e.target);
});
ligar("velocidadeAnimTextoNum", "blur", e => {
  const barra = $("velocidadeAnimTexto");
  if (e.target.value === "" && barra) e.target.value = barra.value;
});

function definirEstadoAnimacao(texto) {
  const campo = $("estadoAnimacaoTexto");
  if (campo) campo.textContent = texto;
}

function removerAnimacaoImportada() {
  animacaoTextoImportada = null;

  const seletor = $("animacaoTexto");
  const opcao = seletor.querySelector('option[value="importada"]');
  if (opcao) opcao.remove();
  if (seletor.value === "importada" || !seletor.value) seletor.value = "none";

  definirEstadoAnimacao("Nenhuma animação importada. Baixe o modelo, edite e importe de volta.");
}

ligar("arquivoAnimacaoTexto", "change", async event => {
  const arquivo = event.target.files && event.target.files[0];
  if (!arquivo) return;

  try {
    const conteudo = await arquivo.text();
    const preset = normalizarPresetAnimacao(JSON.parse(conteudo));

    if (!preset) {
      throw new Error("O arquivo precisa ter uma lista \"keyframes\" com pelo menos 2 pontos.");
    }

    animacaoTextoImportada = preset;

    const seletor = $("animacaoTexto");
    let opcao = seletor.querySelector('option[value="importada"]');

    if (!opcao) {
      opcao = document.createElement("option");
      opcao.value = "importada";
      seletor.appendChild(opcao);
    }

    opcao.textContent = "Importada: " + preset.nome;
    seletor.value = "importada";

    definirEstadoAnimacao("Animação \"" + preset.nome + "\" importada e selecionada.");
    mensagem("Animação do texto importada: " + preset.nome + ".");
    renderizar();
  } catch (erro) {
    definirEstadoAnimacao(
      "Não foi possível importar: " + (erro && erro.message ? erro.message : "arquivo inválido")
    );
    mensagem("Não foi possível importar a animação do texto.");
  } finally {
    event.target.value = "";
  }
});

ligar("baixarModeloAnimacaoTexto", "click", () => {
  const blob = new Blob(
    [JSON.stringify(MODELO_ANIMACAO_TEXTO, null, 2)],
    { type: "application/json" }
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "modelo-animacao-texto.json";
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

ligar("removerAnimacaoTexto", "click", () => {
  removerAnimacaoImportada();
  renderizar();
});

function desenharLegenda(legenda, tempo) {
  if (!legenda || !legenda.texto) return;

  const largura = canvas.width;
  const altura = canvas.height;

  const tamanhoBase = Number($("tamanhoTexto").value) * largura / 720;
  const fonteSelecionada = $("fonteTexto").value;
  const familia = fonteSelecionada === "custom"
    ? (fontePersonalizada || "Arial")
    : fonteSelecionada;

  const animacao = $("animacaoTexto").value;
  const efeito = $("efeitoTexto").value;

  const corTexto = corValida($("corTexto").value, "#ffffff");
  const corDestaque = corValida($("corDestaque").value, "#72f0b0");
  const corEfeito = corValida($("corEfeito").value, "#000000");

  const velocidade = velocidadeAnimacaoTexto();

  const duracaoLegenda = Math.max(0.01, legenda.fim - legenda.inicio);
  const progresso = limitar((tempo - legenda.inicio) / duracaoLegenda, 0, 1);
  const tempoEntrada = Math.max(0, tempo - legenda.inicio);

  const preset = obterPresetAnimacao(animacao);
  const modoPreset = preset ? preset.modo : "linha";
  const palavrasTodas = String(legenda.texto).split(/\s+/).filter(Boolean);

  const substituirPalavra = modoPreset === "palavra";
  const layoutPalavras = animacao === "karaoke" || modoPreset === "acumular";
  const usaPalavras = palavrasTodas.length > 0 && (substituirPalavra || layoutPalavras);

  /* Palavra atual: o tempo da linha é dividido pelo tamanho das palavras. */
  let indicePalavra = 0;
  let tempoNaPalavra = 0;
  let duracaoSlot = duracaoLegenda;

  if (usaPalavras) {
    const limites = limitesPalavrasDaLegenda(legenda);
    const quantidade = palavrasTodas.length;
    let inicioSlot = 0;
    let fimSlot = 1;

    indicePalavra = quantidade - 1;

    for (let i = 0; i < quantidade; i++) {
      const fimDaPalavra = i < quantidade - 1 ? limites[i] : 1;

      if (progresso < fimDaPalavra || i === quantidade - 1) {
        indicePalavra = i;
        inicioSlot = i === 0 ? 0 : limites[i - 1];
        fimSlot = fimDaPalavra;
        break;
      }
    }

    duracaoSlot = Math.max(0.01, (fimSlot - inicioSlot) * duracaoLegenda);
    tempoNaPalavra = (progresso - inicioSlot) * duracaoLegenda;
  }

  let estado = { ...ESTADO_NEUTRO };
  let texto = legenda.texto;

  if (preset && modoPreset === "linha") {
    estado = estadoAnimacaoTexto(preset, tempoEntrada / (preset.duracao / velocidade));
  } else if (preset && substituirPalavra) {
    const duracaoEntrada = Math.max(0.03, Math.min(preset.duracao / velocidade, duracaoSlot * 0.7));
    estado = estadoAnimacaoTexto(preset, tempoNaPalavra / duracaoEntrada);

    /* A palavra some rapidamente antes da próxima entrar. */
    if (indicePalavra < palavrasTodas.length - 1) {
      const janela = Math.max(0.02, Math.min(0.06, duracaoSlot * 0.25));
      estado.opacity *= limitar((duracaoSlot - tempoNaPalavra) / janela, 0, 1);
    }

    texto = palavrasTodas[indicePalavra];
  }

  if (animacao === "typewriter") {
    const quantidade = Math.max(1, Math.floor(texto.length * limitar(tempoEntrada / 1.8, 0, 1)));
    texto = texto.slice(0, quantidade);
  }

  const larguraMaxima = largura * 0.86;

  ctx.save();

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

  /* A animação gira e escala a partir do centro do texto. */
  ctx.globalAlpha = limitar(estado.opacity, 0, 1);
  ctx.translate(largura / 2 + estado.x * tamanhoBase, centroY + estado.y * tamanhoBase);
  if (estado.rotate) ctx.rotate(estado.rotate * Math.PI / 180);
  const escala = Math.max(0.001, estado.scale);
  ctx.scale(escala, escala);

  const yInicial = -alturaTotal / 2 + alturaLinha / 2;

  if (efeito === "shadow") {
    ctx.shadowColor = corEfeito;
    ctx.shadowBlur = Number($("intensidadeEfeito").value) * largura / 720;
    ctx.shadowOffsetX = 2 * largura / 720;
    ctx.shadowOffsetY = 4 * largura / 720;
  } else if (efeito === "glow" || efeito === "neon") {
    ctx.shadowColor = efeito === "neon" ? corDestaque : corEfeito;
    ctx.shadowBlur = Number($("intensidadeEfeito").value) * largura / 720;
  }

  const contorno = (str, x, y) => {
    if (efeito === "outline") {
      ctx.lineWidth = Math.max(2, tamanhoBase * 0.09);
      ctx.strokeStyle = corEfeito;
      ctx.strokeText(str, x, y, larguraMaxima);
    }

    if (efeito === "neon") {
      ctx.lineWidth = Math.max(1, tamanhoBase * 0.025);
      ctx.strokeStyle = corDestaque;
      ctx.strokeText(str, x, y, larguraMaxima);
    }
  };

  let contadorPalavras = 0;

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    const y = yInicial + i * alturaLinha;

    if (layoutPalavras) {
      /* Cada palavra tem posição fixa na linha completa. */
      const palavrasLinha = linha.split(" ");
      const larguraLinha = ctx.measureText(linha).width;
      let prefixo = "";

      for (const palavra of palavrasLinha) {
        const idx = contadorPalavras++;
        const xInicio = -larguraLinha / 2 + ctx.measureText(prefixo).width;
        const larguraPalavra = ctx.measureText(palavra).width;
        prefixo += palavra + " ";

        if (animacao === "karaoke") {
          ctx.textAlign = "left";
          contorno(palavra, xInicio, y);
          ctx.fillStyle = idx <= indicePalavra ? corDestaque : corTexto;
          ctx.fillText(palavra, xInicio, y);
          ctx.textAlign = "center";
          continue;
        }

        if (idx > indicePalavra) continue;

        let estadoPalavra = { ...ESTADO_NEUTRO };

        if (idx === indicePalavra) {
          const duracaoEntrada = Math.max(
            0.03,
            Math.min(preset.duracao / velocidade, duracaoSlot * 0.9)
          );
          estadoPalavra = estadoAnimacaoTexto(preset, tempoNaPalavra / duracaoEntrada);
        } else {
          estadoPalavra = estadoAnimacaoTexto(preset, 1);
        }

        ctx.save();
        ctx.globalAlpha *= limitar(estadoPalavra.opacity, 0, 1);
        ctx.translate(
          xInicio + larguraPalavra / 2 + estadoPalavra.x * tamanhoBase,
          y + estadoPalavra.y * tamanhoBase
        );
        if (estadoPalavra.rotate) ctx.rotate(estadoPalavra.rotate * Math.PI / 180);
        const escalaPalavra = Math.max(0.001, estadoPalavra.scale);
        ctx.scale(escalaPalavra, escalaPalavra);
        contorno(palavra, 0, 0);
        ctx.fillStyle = corTexto;
        ctx.fillText(palavra, 0, 0);
        ctx.restore();
      }

      continue;
    }

    contorno(linha, 0, y);

    if (animacao === "highlight") {
      const proporcao = limitar(progresso * 1.4, 0, 1);
      const medida = ctx.measureText(linha).width;
      const inicio = -medida / 2;
      const limiteDestaque = inicio + medida * proporcao;

      ctx.fillStyle = corTexto;
      ctx.fillText(linha, 0, y, larguraMaxima);

      ctx.save();
      ctx.beginPath();
      ctx.rect(inicio - 2, y - alturaLinha / 2, Math.max(0, limiteDestaque - inicio + 2), alturaLinha);
      ctx.clip();
      ctx.fillStyle = corDestaque;
      ctx.fillText(linha, 0, y, larguraMaxima);
      ctx.restore();
    } else {
      ctx.fillStyle = corTexto;
      ctx.fillText(linha, 0, y);
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

  if (analisador && dadosAudio) analisador.getByteFrequencyData(dadosAudio);

  ctx.save();
  ctx.fillStyle = cor;
  ctx.globalAlpha = 0.8;

  for (let i = 0; i < quantidade; i++) {
    let valor;

    if (dadosAudio) {
      const indice = Math.floor(i * dadosAudio.length / quantidade);
      valor = dadosAudio[indice] / 255;
    } else {
      valor = 0.08;
    }

    const barraAltura = Math.max(3, valor * altura * 0.08);
    const x = inicioX + i * espacamento;

    ctx.beginPath();
    ctx.roundRect(x, baseY - barraAltura, larguraBarra, barraAltura, Math.min(5, larguraBarra / 2));
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

  if (videoFundo.readyState < 2 || !videoFundo.videoWidth) return;

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

  ctx.drawImage(videoFundo, (largura - w) / 2, (altura - h) / 2, w, h);
}

function desenharAdesivos() {
  const tempo = audio.currentTime || 0;

  elementosVisuais.forEach(item => {
    if (typeof window.desenharAdesivoAnimado === "function") {
      window.desenharAdesivoAnimado(item, tempo);
      return;
    }

    if (!item.imagem || !item.imagem.complete) return;

    const escala = item.escala / 100;
    const largura = item.largura * escala;
    const altura = item.altura * escala;

    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.rotate(item.rotacao * Math.PI / 180);
    ctx.drawImage(item.imagem, -largura / 2, -altura / 2, largura, altura);

    if (!exportando && item.id === imagemSelecionada) {
      ctx.strokeStyle = "#72f0b0";
      ctx.lineWidth = Math.max(1, canvas.width / 720);
      ctx.setLineDash([7, 5]);
      ctx.strokeRect(-largura / 2, -altura / 2, largura, altura);
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

  if (legenda) desenharLegenda(legenda, tempo);

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
    ctx.fillText("Importe uma música para começar", canvas.width / 2, canvas.height / 2 + 25);
    ctx.restore();
  }
}

/* =========================================================
   CONTROLES DE APARÊNCIA
========================================================= */

["formato", "resolucao"].forEach(id => {
  $(id).addEventListener("change", definirFormato);
});

[
  "posicaoTexto",
  "corFundo",
  "corTexto",
  "corDestaque",
  "fonteTexto",
  "animacaoTexto",
  "velocidadeAnimTexto",
  "efeitoTexto",
  "corEfeito",
  "intensidadeEfeito",
  "mostrarAudio"
].forEach(id => {
  ligar(id, "input", renderizar);
  ligar(id, "change", renderizar);
});

$("tamanhoTexto").addEventListener("input", () => {
  definirTamanhoTexto();
  renderizar();
});

/* =========================================================
   TIMELINE / TRIM
========================================================= */

(function timelineTrimInit() {
  const bar = document.getElementById("timelineBar");
  const range = document.getElementById("timelineRange");
  const handleStart = document.getElementById("handleStart");
  const handleEnd = document.getElementById("handleEnd");
  const labelStart = document.getElementById("trimStartLabel");
  const labelEnd = document.getElementById("trimEndLabel");
  const btnReset = document.getElementById("trimReset");
  const btnApply = document.getElementById("trimApply");

  if (!bar || !handleStart || !handleEnd) return;

  let duration = obterDuracao() || 0;
  let trimStart = 0;
  let trimEnd = null;
  let personalizado = false;
  const minGap = 0.05;

  function formatTimeShort(s) {
    if (!Number.isFinite(s)) s = 0;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
  }

  function timeToPct(t) {
    if (!duration || duration <= 0) return 0;
    return Math.max(0, Math.min(1, t / duration));
  }

  function pctToTime(p) {
    return Math.max(0, Math.min(duration, p * duration));
  }

  function atualizarLabels() {
    labelStart.textContent = formatTimeShort(trimStart || 0);
    labelEnd.textContent = formatTimeShort(trimEnd == null ? duration : trimEnd);
  }

  function renderHandles() {
    const rect = bar.getBoundingClientRect();
    const leftPct = timeToPct(trimStart || 0);
    const rightPct = timeToPct(trimEnd == null ? duration : trimEnd);

    handleStart.style.left = `${leftPct * 100}%`;
    handleEnd.style.left = `${rightPct * 100}%`;

    range.style.left = `${leftPct * 100}%`;
    range.style.width = `${Math.max(0, (rightPct - leftPct) * 100)}%`;
  }

  function atualizarDuracao() {
    duration = obterDuracao() || 0;

    if (!personalizado) {
      /* Sem corte manual, o trecho acompanha a duração real do áudio atual. */
      trimStart = 0;
      trimEnd = duration || null;
    } else {
      if (trimEnd == null || trimEnd > duration) trimEnd = duration;
      if (trimStart >= trimEnd) trimStart = 0;
    }

    renderHandles();
    atualizarLabels();
  }

  audio.addEventListener("loadedmetadata", atualizarDuracao);
  audio.addEventListener("durationchange", atualizarDuracao);

  /* Ao trocar de música, o corte volta a cobrir o áudio inteiro. */
  audio.addEventListener("loadstart", () => {
    personalizado = false;
    trimStart = 0;
    trimEnd = null;
  });

  let active = null;

  function onPointerDown(e, which) {
    e.preventDefault();
    active = which;
    e.target?.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e) {
    if (!active) return;
    const rect = bar.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    const time = pctToTime(pct);

    personalizado = true;

    if (active === "start") {
      const newStart = Math.min(time, (trimEnd == null ? duration : trimEnd) - minGap);
      trimStart = Math.max(0, newStart);
    } else if (active === "end") {
      const newEnd = Math.max(time, (trimStart || 0) + minGap);
      trimEnd = Math.min(duration, newEnd);
    }

    renderHandles();
    atualizarLabels();
  }

  function onPointerUp() {
    active = null;
  }

  handleStart.addEventListener("pointerdown", e => onPointerDown(e, "start"));
  handleEnd.addEventListener("pointerdown", e => onPointerDown(e, "end"));
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  function handleKey(e, which) {
    const step = e.shiftKey ? 0.5 : 0.1;
    personalizado = true;
    if (which === "start") {
      if (e.key === "ArrowLeft") trimStart = Math.max(0, (trimStart || 0) - step);
      if (e.key === "ArrowRight") trimStart = Math.min((trimEnd == null ? duration : trimEnd) - minGap, (trimStart || 0) + step);
    } else {
      if (e.key === "ArrowLeft") trimEnd = Math.max((trimStart || 0) + minGap, (trimEnd == null ? duration : trimEnd) - step);
      if (e.key === "ArrowRight") trimEnd = Math.min(duration, (trimEnd == null ? duration : trimEnd) + step);
    }
    renderHandles();
    atualizarLabels();
  }

  handleStart.addEventListener("keydown", e => handleKey(e, "start"));
  handleEnd.addEventListener("keydown", e => handleKey(e, "end"));

  btnReset.addEventListener("click", () => {
    personalizado = false;
    trimStart = 0;
    trimEnd = duration || null;
    renderHandles();
    atualizarLabels();
    mensagem("Trim resetado.");
  });

  btnApply.addEventListener("click", () => {
    if (!duration) {
      mensagem("Carregue o áudio antes de aplicar o trim.");
      return;
    }

    if (trimEnd == null) trimEnd = duration;

    if (audio.src) {
      audio.currentTime = trimStart || 0;
      mensagem(`Trim aplicado: ${formatTimeShort(trimStart || 0)} → ${formatTimeShort(trimEnd)}`);
    }
  });

  window._editorTrim = {
    getStart: () => (personalizado ? (trimStart || 0) : 0),
    getEnd: () => {
      const total = obterDuracao() || duration;
      return personalizado && trimEnd != null ? Math.min(trimEnd, total) : total;
    },
    setStartEnd: (s, e) => {
      personalizado = true;
      trimStart = Math.max(0, Math.min(s, duration));
      trimEnd = Math.max(trimStart + minGap, Math.min(e, duration));
      renderHandles();
      atualizarLabels();
    }
  };

  window.addEventListener("resize", renderHandles);

  atualizarDuracao();
})();

/* =========================================================
   EXPORTAÇÃO DE VÍDEO
========================================================= */

function obterTipoGravacao() {
  if (!window.MediaRecorder) return null;

  /* MP4 só entra com áudio AAC explícito: MP4 com Opus não abre em vários
     players e editores ("codec de áudio não compatível"). */
  const tipos = [
    "video/mp4;codecs=avc1.640028,mp4a.40.2",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1,mp4a.40.2",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];

  return tipos.find(tipo => MediaRecorder.isTypeSupported(tipo)) || "";
}

function descreverFormato(mime) {
  const m = String(mime || "").toLowerCase();

  if (m.includes("mp4")) return m.includes("mp4a") ? "MP4 (H.264 + AAC)" : "MP4";
  if (m.includes("vp9")) return "WebM (VP9 + Opus)";
  if (m.includes("vp8")) return "WebM (VP8 + Opus)";
  return "WebM";
}

/* O WebM gravado pelo navegador não traz a duração no cabeçalho, e muitos
   players mostram tempo errado ou travam. Aqui a duração é gravada no arquivo. */
async function adicionarDuracaoWebm(blob, segundos) {
  try {
    if (!(segundos > 0)) return blob;

    const cabeca = new Uint8Array(await blob.slice(0, 8192).arrayBuffer());

    const lerVint = (pos, manterMarcador) => {
      const primeiro = cabeca[pos];
      if (!primeiro) return null;

      let tamanho = 1;
      let mascara = 0x80;
      while (tamanho <= 8 && !(primeiro & mascara)) { tamanho++; mascara >>= 1; }
      if (tamanho > 8 || pos + tamanho > cabeca.length) return null;

      let valor = manterMarcador ? primeiro : primeiro & (mascara - 1);
      let todosUns = (primeiro & (mascara - 1)) === mascara - 1;

      for (let k = 1; k < tamanho; k++) {
        valor = valor * 256 + cabeca[pos + k];
        if (cabeca[pos + k] !== 0xff) todosUns = false;
      }

      return { valor, tamanho, desconhecido: !manterMarcador && todosUns };
    };

    /* Cabeçalho EBML */
    let pos = 0;
    const idEbml = lerVint(pos, true);
    if (!idEbml || idEbml.valor !== 0x1A45DFA3) return blob;
    pos += idEbml.tamanho;
    const tamEbml = lerVint(pos, false);
    if (!tamEbml) return blob;
    pos += tamEbml.tamanho + tamEbml.valor;

    /* Segment (tamanho desconhecido na gravação ao vivo) */
    const idSegmento = lerVint(pos, true);
    if (!idSegmento || idSegmento.valor !== 0x18538067) return blob;
    pos += idSegmento.tamanho;
    const tamSegmento = lerVint(pos, false);
    if (!tamSegmento) return blob;
    pos += tamSegmento.tamanho;

    /* Procura o elemento Info entre os filhos do Segment */
    let inicioInfo = -1;
    let tamanhoInfo = 0;
    let tamanhoCampoInfo = 0;

    while (pos < cabeca.length - 12) {
      const id = lerVint(pos, true);
      if (!id) return blob;
      const tam = lerVint(pos + id.tamanho, false);
      if (!tam || tam.desconhecido) return blob;

      if (id.valor === 0x1549A966) {
        inicioInfo = pos;
        tamanhoInfo = tam.valor;
        tamanhoCampoInfo = tam.tamanho;
        pos += id.tamanho;
        break;
      }

      pos += id.tamanho + tam.tamanho + tam.valor;
    }

    if (inicioInfo < 0) return blob;

    const dadosInfo = inicioInfo + 4 + tamanhoCampoInfo;
    const fimInfo = dadosInfo + tamanhoInfo;
    if (fimInfo > cabeca.length) return blob;

    /* Lê os filhos de Info: escala de tempo e se a duração já existe */
    let escala = 1000000;
    let cursor = dadosInfo;

    while (cursor < fimInfo) {
      const id = lerVint(cursor, true);
      if (!id) return blob;
      const tam = lerVint(cursor + id.tamanho, false);
      if (!tam) return blob;
      const dados = cursor + id.tamanho + tam.tamanho;

      if (id.valor === 0x4489) return blob;

      if (id.valor === 0x2AD7B1) {
        let v = 0;
        for (let k = 0; k < tam.valor; k++) v = v * 256 + cabeca[dados + k];
        if (v > 0) escala = v;
      }

      cursor = dados + tam.valor;
    }

    const duracao = new Uint8Array(11);
    duracao[0] = 0x44;
    duracao[1] = 0x89;
    duracao[2] = 0x88;
    new DataView(duracao.buffer).setFloat64(3, (segundos * 1e9) / escala);

    const novoTamanho = tamanhoInfo + duracao.length;
    const cabecaInfo = new Uint8Array([
      0x15, 0x49, 0xA9, 0x66,
      0x10 | ((novoTamanho >>> 24) & 0x0f),
      (novoTamanho >>> 16) & 0xff,
      (novoTamanho >>> 8) & 0xff,
      novoTamanho & 0xff
    ]);

    return new Blob([
      cabeca.slice(0, inicioInfo),
      cabecaInfo,
      cabeca.slice(dadosInfo, fimInfo),
      duracao,
      blob.slice(fimInfo)
    ], { type: blob.type });
  } catch (erro) {
    console.warn("Não foi possível gravar a duração no WebM.", erro);
    return blob;
  }
}

/* =========================================================
   MP4 FRAGMENTADO -> MP4 NORMAL
   O MediaRecorder grava MP4 "fragmentado", sem duração no
   cabeçalho. Galeria/TikTok/Instagram leem só o primeiro
   pedaço (~3s). Aqui reorganizamos o arquivo com as tabelas
   normais (stts/stsz/stco...) e a duração correta.
========================================================= */
async function consertarMp4Fragmentado(blob) {
  try {
    const CONT = new Set(["moov", "trak", "mdia", "minf", "stbl", "mvex", "edts", "dinf", "moof", "traf"]);
    const enc = new TextEncoder();
    const tipoDe = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

    function lerCaixas(buf, ini, fim) {
      const lista = [];
      let p = ini;
      while (p + 8 <= fim) {
        const dv = new DataView(buf.buffer, buf.byteOffset + p, Math.min(16, fim - p));
        let tam = dv.getUint32(0);
        const tipo = tipoDe(dv, 4);
        let hdr = 8;
        if (tam === 1) { tam = Number(dv.getBigUint64(8)); hdr = 16; }
        else if (tam === 0) tam = fim - p;
        if (tam < hdr || p + tam > fim) break;
        const cx = { tipo };
        if (CONT.has(tipo)) cx.filhos = lerCaixas(buf, p + hdr, p + tam);
        else cx.dados = buf.slice(p + hdr, p + tam);
        lista.push(cx);
        p += tam;
      }
      return lista;
    }

    function juntar(partes) {
      let total = 0;
      partes.forEach(x => { total += x.length; });
      const out = new Uint8Array(total);
      let o = 0;
      partes.forEach(x => { out.set(x, o); o += x.length; });
      return out;
    }

    function montar(cx) {
      const payload = cx.filhos ? juntar(cx.filhos.map(montar)) : cx.dados;
      const out = new Uint8Array(8 + payload.length);
      new DataView(out.buffer).setUint32(0, out.length);
      out.set(enc.encode(cx.tipo), 4);
      out.set(payload, 8);
      return out;
    }

    const filho = (cx, tipo) => (cx.filhos || []).find(f => f.tipo === tipo);
    const filhosDe = (cx, tipo) => (cx.filhos || []).filter(f => f.tipo === tipo);
    const dvDe = cx => new DataView(cx.dados.buffer, cx.dados.byteOffset, cx.dados.byteLength);

    /* Caixas do nível superior */
    const topo = [];
    let pos = 0;
    while (pos + 8 <= blob.size) {
      const dv = new DataView(await blob.slice(pos, pos + 16).arrayBuffer());
      let tam = dv.getUint32(0);
      const tipo = tipoDe(dv, 4);
      let hdr = 8;
      if (tam === 1) { tam = Number(dv.getBigUint64(8)); hdr = 16; }
      else if (tam === 0) tam = blob.size - pos;
      if (tam < hdr) break;
      topo.push({ tipo, pos, tam });
      pos += tam;
    }

    const ftyp = topo.find(c => c.tipo === "ftyp");
    const moovInfo = topo.find(c => c.tipo === "moov");
    const moofs = topo.filter(c => c.tipo === "moof");
    if (!ftyp || !moovInfo || !moofs.length) return blob; /* já é MP4 normal */

    const ftypBytes = new Uint8Array(await blob.slice(ftyp.pos, ftyp.pos + ftyp.tam).arrayBuffer());
    const moovBytes = new Uint8Array(await blob.slice(moovInfo.pos, moovInfo.pos + moovInfo.tam).arrayBuffer());
    const moov = lerCaixas(moovBytes, 0, moovBytes.length)[0];
    if (!moov || moov.tipo !== "moov") return blob;

    /* Informações de cada trilha */
    const trilhas = new Map();
    const trexPadrao = new Map();

    const mvex = filho(moov, "mvex");
    if (mvex) {
      filhosDe(mvex, "trex").forEach(t => {
        const d = dvDe(t);
        trexPadrao.set(d.getUint32(4), { dur: d.getUint32(12), tam: d.getUint32(16), flags: d.getUint32(20) });
      });
    }

    filhosDe(moov, "trak").forEach(trak => {
      const tkhd = dvDe(filho(trak, "tkhd"));
      const id = tkhd.getUint32(tkhd.getUint8(0) === 1 ? 20 : 12);
      const mdia = filho(trak, "mdia");
      const mdhd = dvDe(filho(mdia, "mdhd"));
      const escala = mdhd.getUint32(mdhd.getUint8(0) === 1 ? 20 : 12);
      const hdlr = dvDe(filho(mdia, "hdlr"));
      const video = tipoDe(hdlr, 8) === "vide";
      trilhas.set(id, { id, trak, escala, video, amostras: [], chunks: [], primeiroTfdt: null });
    });

    if (!trilhas.size) return blob;

    /* Lê os fragmentos (moof) */
    const blocos = []; /* ordem em que os dados irão para o mdat */

    for (const m of moofs) {
      const bytes = new Uint8Array(await blob.slice(m.pos, m.pos + m.tam).arrayBuffer());
      const moof = lerCaixas(bytes, 0, bytes.length)[0];
      if (!moof || moof.tipo !== "moof") return blob;

      for (const traf of filhosDe(moof, "traf")) {
        const tfhdCx = filho(traf, "tfhd");
        if (!tfhdCx) continue;
        const th = dvDe(tfhdCx);
        const flagsTf = th.getUint32(0) & 0xffffff;
        const idTrilha = th.getUint32(4);
        const trilha = trilhas.get(idTrilha);
        if (!trilha) continue;

        let o = 8;
        let base = m.pos;
        if (flagsTf & 0x1) { base = Number(th.getBigUint64(o)); o += 8; }
        if (flagsTf & 0x2) o += 4;
        const padrao = Object.assign({ dur: 0, tam: 0, flags: 0 }, trexPadrao.get(idTrilha));
        if (flagsTf & 0x8) { padrao.dur = th.getUint32(o); o += 4; }
        if (flagsTf & 0x10) { padrao.tam = th.getUint32(o); o += 4; }
        if (flagsTf & 0x20) { padrao.flags = th.getUint32(o); o += 4; }

        const tfdtCx = filho(traf, "tfdt");
        if (tfdtCx && trilha.primeiroTfdt === null) {
          const td = dvDe(tfdtCx);
          trilha.primeiroTfdt = td.getUint8(0) === 1 ? Number(td.getBigUint64(4)) : td.getUint32(4);
        }

        let fimAnterior = base;

        for (const trun of filhosDe(traf, "trun")) {
          const d = dvDe(trun);
          const versao = d.getUint8(0);
          const fl = d.getUint32(0) & 0xffffff;
          const n = d.getUint32(4);
          let p = 8;
          let inicio = fimAnterior;
          if (fl & 0x1) { inicio = base + d.getInt32(p); p += 4; }
          let primeiroFlags = null;
          if (fl & 0x4) { primeiroFlags = d.getUint32(p); p += 4; }

          const indiceInicial = trilha.amostras.length;
          let bytesTotal = 0;

          for (let i = 0; i < n; i++) {
            const dur = (fl & 0x100) ? d.getUint32(p) : padrao.dur; if (fl & 0x100) p += 4;
            const tam = (fl & 0x200) ? d.getUint32(p) : padrao.tam; if (fl & 0x200) p += 4;
            let flags = padrao.flags;
            if (fl & 0x400) { flags = d.getUint32(p); p += 4; }
            else if (i === 0 && primeiroFlags !== null) flags = primeiroFlags;
            let cto = 0;
            if (fl & 0x800) { cto = versao === 1 ? d.getInt32(p) : d.getUint32(p); p += 4; }

            trilha.amostras.push({ dur, tam, sync: !(flags & 0x10000), cto });
            bytesTotal += tam;
          }

          fimAnterior = inicio + bytesTotal;
          if (n > 0) {
            blocos.push({ trilha, off: inicio, len: bytesTotal, n });
          }
        }
      }
    }

    if (!blocos.length) return blob;

    const totalDados = blocos.reduce((s, b) => s + b.len, 0);
    if (totalDados > 0xfff00000) return blob;

    /* Tabelas */
    const u32s = (...v) => { const b = new Uint8Array(v.length * 4); const dv = new DataView(b.buffer); v.forEach((x, i) => dv.setUint32(i * 4, x >>> 0)); return b; };
    const caixa = (tipo, dados) => ({ tipo, dados });

    function rle(valores) {
      const out = [];
      valores.forEach(v => {
        const u = out[out.length - 1];
        if (u && u[1] === v) u[0]++; else out.push([1, v]);
      });
      return out;
    }

    function tabelasDe(trilha, baseMdat) {
      const am = trilha.amostras;
      const lista = [];

      const stts = rle(am.map(a => a.dur));
      lista.push(caixa("stts", juntar([u32s(0, stts.length), ...stts.map(([c, v]) => u32s(c, v))])));

      if (am.some(a => a.cto !== 0)) {
        const ctts = rle(am.map(a => a.cto));
        const neg = am.some(a => a.cto < 0);
        lista.push(caixa("ctts", juntar([u32s(neg ? 0x01000000 : 0, ctts.length), ...ctts.map(([c, v]) => u32s(c, v))])));
      }

      if (trilha.video && am.some(a => !a.sync)) {
        const idx = [];
        am.forEach((a, i) => { if (a.sync) idx.push(i + 1); });
        lista.push(caixa("stss", juntar([u32s(0, idx.length), u32s(...idx)])));
      }

      const mine = blocos.filter(b => b.trilha === trilha);
      const stsc = [];
      mine.forEach((b, i) => {
        const u = stsc[stsc.length - 1];
        if (!u || u[1] !== b.n) stsc.push([i + 1, b.n]);
      });
      lista.push(caixa("stsc", juntar([u32s(0, stsc.length), ...stsc.map(([a, b]) => u32s(a, b, 1))])));

      lista.push(caixa("stsz", juntar([u32s(0, 0, am.length), u32s(...am.map(a => a.tam))])));

      const offs = [];
      let acum = 0;
      for (const b of blocos) {
        if (b.trilha === trilha) offs.push(baseMdat + acum);
        acum += b.len;
      }
      lista.push(caixa("stco", juntar([u32s(0, offs.length), u32s(...offs)])));

      return lista;
    }

    const lerDur = (d, v0, v1) => (d.getUint8(0) === 1 ? Number(d.getBigUint64(v1)) : d.getUint32(v0));
    const gravarDur = (d, v0, v1, valor) => { if (d.getUint8(0) === 1) d.setBigUint64(v1, BigInt(Math.round(valor))); else d.setUint32(v0, Math.round(valor)); };

    const mvhdDv = dvDe(filho(moov, "mvhd"));
    const escalaFilme = mvhdDv.getUint32(mvhdDv.getUint8(0) === 1 ? 20 : 12);

    function montarMoov(baseMdat) {
      const copia = lerCaixas(moovBytes, 0, moovBytes.length)[0];
      copia.filhos = copia.filhos.filter(f => f.tipo !== "mvex");

      let maiorDuracao = 0;

      filhosDe(copia, "trak").forEach(trak => {
        const tkhd = dvDe(filho(trak, "tkhd"));
        const id = tkhd.getUint32(tkhd.getUint8(0) === 1 ? 20 : 12);
        const trilha = trilhas.get(id);
        if (!trilha) return;

        const durMidia = trilha.amostras.reduce((s, a) => s + a.dur, 0);
        const atraso = trilha.primeiroTfdt || 0;
        const durFilme = ((durMidia + atraso) * escalaFilme) / trilha.escala;
        maiorDuracao = Math.max(maiorDuracao, durFilme);

        gravarDur(tkhd, 20, 28, durFilme);

        const mdia = filho(trak, "mdia");
        gravarDur(dvDe(filho(mdia, "mdhd")), 16, 24, durMidia);

        const minf = filho(mdia, "minf");
        const stbl = filho(minf, "stbl");
        const mantidos = stbl.filhos.filter(f => f.tipo === "stsd");
        stbl.filhos = [...mantidos, ...tabelasDe(trilha, baseMdat)];

        trak.filhos = trak.filhos.filter(f => f.tipo !== "edts");
        if (atraso > 0) {
          const vazio = Math.round((atraso * escalaFilme) / trilha.escala);
          const real = Math.round((durMidia * escalaFilme) / trilha.escala);
          const elst = new Uint8Array(8 + 24);
          const ev = new DataView(elst.buffer);
          ev.setUint32(4, 2);
          ev.setUint32(8, vazio); ev.setInt32(12, -1); ev.setUint32(16, 0x00010000);
          ev.setUint32(20, real); ev.setInt32(24, 0); ev.setUint32(28, 0x00010000);
          const edts = { tipo: "edts", filhos: [caixa("elst", elst)] };
          const i = trak.filhos.findIndex(f => f.tipo === "tkhd");
          trak.filhos.splice(i + 1, 0, edts);
        }
      });

      gravarDur(mvhdDv, 16, 24, maiorDuracao);
      const mvhdNovo = copia.filhos.find(f => f.tipo === "mvhd");
      mvhdNovo.dados = new Uint8Array(mvhdDv.buffer.slice(mvhdDv.byteOffset, mvhdDv.byteOffset + mvhdDv.byteLength));

      return montar(copia);
    }

    const tamMoov = montarMoov(0).length;
    const baseMdat = ftypBytes.length + tamMoov + 8;
    const moovFinal = montarMoov(baseMdat);

    const cabMdat = new Uint8Array(8);
    new DataView(cabMdat.buffer).setUint32(0, totalDados + 8);
    cabMdat.set(enc.encode("mdat"), 4);

    return new Blob([
      ftypBytes,
      moovFinal,
      cabMdat,
      ...blocos.map(b => blob.slice(b.off, b.off + b.len))
    ], { type: "video/mp4" });
  } catch (erro) {
    console.warn("Não foi possível reorganizar o MP4.", erro);
    return blob;
  }
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
    mensagem("Este navegador não oferece suporte à exportação de vídeo necessária.");
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

  let trimStart = window._editorTrim?.getStart?.() ?? 0;
  let trimEnd = window._editorTrim?.getEnd?.() ?? obterDuracao();

  if (!(trimEnd - trimStart >= 1)) {
    mensagem("O trecho do trim estava inválido ou muito curto. Exportando o áudio inteiro.");
    trimStart = 0;
    trimEnd = obterDuracao();
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
  /* Clona as faixas: o stream do audioDestination é reutilizado entre exportações.
     Se a faixa original for parada no final (track.stop), a próxima exportação sai muda. */
  const faixasAudio = audioDestination
    ? audioDestination.stream.getAudioTracks().map(faixa => faixa.clone())
    : [];
  faixasAudio.forEach(faixa => streamVideo.addTrack(faixa));

  if (!faixasAudio.length) {
    mensagem("Atenção: não foi possível capturar o áudio. O vídeo pode sair sem som.");
  }

  partesVideo = [];
  let inicioGravacao = 0;

  const opcoes = {};
  if (tipo) opcoes.mimeType = tipo;

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
    if (event.data && event.data.size > 0) partesVideo.push(event.data);
  };

  mediaRecorder.onerror = event => {
    console.error(event.error || event);
    mensagem("Ocorreu um erro durante a exportação.");
    encerrarExportacao();
  };

  mediaRecorder.onstop = async () => {
    const mimeType = mediaRecorder.mimeType || tipo || "video/webm";
    const extensao = mimeType.includes("mp4") ? "mp4" : "webm";
    let blob = new Blob(partesVideo, { type: mimeType });

    if (extensao === "webm") {
      blob = await adicionarDuracaoWebm(blob, (performance.now() - inicioGravacao) / 1000);
    } else {
      /* MP4 do MediaRecorder é fragmentado: sem isso a galeria e o TikTok leem ~3s */
      mensagem("Finalizando o vídeo...");
      blob = await consertarMp4Fragmentado(blob);
    }

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `lyric-studio-${Date.now()}.${extensao}`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 60000);
    streamVideo.getTracks().forEach(track => track.stop()); /* só clones + vídeo do canvas */

    if (!audio.paused) audio.pause();
    if (videoFundo.src) videoFundo.pause();

    encerrarExportacao();
    mensagem(`Exportação concluída. Arquivo gerado: ${descreverFormato(mimeType)}.`);
  };

  exportando = true;
  $("exportar").disabled = true;
  $("pararExportacao").disabled = false;

  if (Math.abs(audio.currentTime - trimStart) > 0.05) {
    await new Promise(resolve => {
      const fim = () => { audio.removeEventListener("seeked", fim); resolve(); };
      audio.addEventListener("seeked", fim);
      audio.currentTime = trimStart;
      setTimeout(fim, 1500);
    });
  }

  if (videoFundo.src) {
    try {
      videoFundo.currentTime = trimStart;
      await videoFundo.play();
    } catch (erro) {
      console.warn("O vídeo de fundo não iniciou automaticamente.", erro);
    }
  }

  renderizar();
  inicioGravacao = performance.now();
  mediaRecorder.start(250);

  try {
    await audio.play();
    mensagem(`Exportando trecho: ${formatarTempo(trimStart)} → ${formatarTempo(trimEnd)}. Não feche a página.`);
  } catch (erro) {
    if (mediaRecorder.state === "recording") mediaRecorder.stop();
    mensagem("Não foi possível iniciar a reprodução do áudio para exportar.");
    return;
  }

  /* Para quando o trecho termina ou o áudio acaba. O cronômetro garante que
     isso aconteça mesmo se a aba ficar em segundo plano. */
  let vigia = null;

  function encerrarSeChegouAoFim() {
    const passouDoFim = audio.currentTime >= trimEnd - 0.02;
    const acabou = audio.ended && audio.currentTime >= obterDuracao() - 0.3;
    if (passouDoFim || acabou) {
      if (mediaRecorder?.state === "recording") mediaRecorder.stop();
      return true;
    }

    return false;
  }

  function acompanharExportacao() {
    if (!exportando) {
      clearInterval(vigia);
      return;
    }

    renderizar();

    if (encerrarSeChegouAoFim()) {
      clearInterval(vigia);
      return;
    }

    rafId = requestAnimationFrame(acompanharExportacao);
  }

  vigia = setInterval(() => {
    if (!exportando) {
      clearInterval(vigia);
      return;
    }

    if (document.hidden) renderizar();

    if (encerrarSeChegouAoFim()) clearInterval(vigia);
  }, 200);

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
atualizarContador();

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

/* =========================================================
   POP-UP DA PRÉVIA
========================================================= */

(() => {
  "use strict";

  function iniciarNovaInterface() {
    const $ = id => document.getElementById(id);

    const preview = document.querySelector(".preview-panel");
    const canvas = $("canvas");
    const audioEl = $("audio");

    if (!preview || !canvas) {
      console.warn("Lyric Studio: elementos da interface não encontrados.");
      return;
    }

    const gavetas = [
      { id: "sec-musica", titulo: "Música e áudio", icone: "♫" },
      { id: "sec-letra", titulo: "Letra com tempos", icone: "≡" },
      { id: "sec-legendas", titulo: "Ondas", icone: "◷" },
      { id: "sec-aparencia", titulo: "Aparência e texto", icone: "Aa" },
      { id: "sec-recursos", titulo: "Recursos visuais", icone: "▧" },
      { id: "sec-exportar", titulo: "Exportar vídeo", icone: "⇩" }
    ];

    gavetas.forEach(config => {
      const secao = $(config.id);
      if (!secao) return;

      secao.classList.add("drawer-section");

      let cabecalho = secao.querySelector(":scope > .drawer-toggle");
      let corpo = secao.querySelector(":scope > .drawer-body");

      if (!cabecalho || !corpo) {
        const filhos = Array.from(secao.childNodes);

        cabecalho = document.createElement("button");
        corpo = document.createElement("div");

        cabecalho.type = "button";
        cabecalho.className = "drawer-toggle";
        cabecalho.innerHTML = `
          <span class="drawer-toggle-label">
            <span class="drawer-icon" aria-hidden="true">${config.icone}</span>
            <span>${config.titulo}</span>
          </span>
          <span class="drawer-chevron" aria-hidden="true">⌄</span>
        `;

        corpo.className = "drawer-body";
        filhos.forEach(filho => corpo.appendChild(filho));
        secao.append(cabecalho, corpo);
      }

      corpo.hidden = true;
      cabecalho.setAttribute("aria-expanded", "false");

      if (cabecalho.dataset.drawerClickReady !== "true") {
        cabecalho.dataset.drawerClickReady = "true";

        cabecalho.addEventListener("click", () => {
          const abrir = corpo.hidden;
          corpo.hidden = !abrir;
          cabecalho.setAttribute("aria-expanded", String(abrir));
        });
      }
    });

    function sincronizarSubgaveta(detalhe) {
      const conteudo = detalhe.querySelector(":scope > .subdrawer-content");
      if (!conteudo) return;

      conteudo.hidden = false;

      if (detalhe.open) {
        conteudo.style.display = "block";
        conteudo.style.visibility = "visible";
      } else {
        conteudo.style.display = "none";
      }
    }

    document.querySelectorAll("details.subdrawer").forEach(detalhe => {
      const resumo = detalhe.querySelector(":scope > summary");
      if (!resumo || detalhe.dataset.subdrawerReady === "true") return;

      detalhe.dataset.subdrawerReady = "true";
      detalhe.open = false;
      sincronizarSubgaveta(detalhe);

      resumo.addEventListener("click", evento => {
        evento.preventDefault();
        evento.stopPropagation();
        detalhe.open = !detalhe.open;
        sincronizarSubgaveta(detalhe);
      });

      resumo.addEventListener("keydown", evento => {
        if (evento.key === " " || evento.key === "Enter") {
          evento.preventDefault();
          detalhe.open = !detalhe.open;
          sincronizarSubgaveta(detalhe);
        }
      });
    });

    let modal = $("previewModal");

    if (!modal) {
      modal = document.createElement("div");
      modal.id = "previewModal";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-labelledby", "previewModalTitulo");

      modal.innerHTML = `
        <div class="preview-modal-card">
          <div class="preview-modal-header">
            <h2 id="previewModalTitulo">Prévia do vídeo</h2>
            <button id="fecharPreviewModal" type="button" aria-label="Fechar prévia">×</button>
          </div>
          <div id="previewModalContent"></div>
          <div class="preview-modal-controls">
            <button id="previewModalPlay" type="button">▶ Reproduzir áudio</button>
            <span id="previewModalTempo">00:00 / 00:00</span>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
    }

    let abrirPreviewButton = $("abrirPreviewModal");

    if (!abrirPreviewButton) {
      abrirPreviewButton = document.createElement("button");
      abrirPreviewButton.id = "abrirPreviewModal";
      abrirPreviewButton.type = "button";
      abrirPreviewButton.textContent = "⛶ Abrir prévia em tela ampliada";
      preview.appendChild(abrirPreviewButton);
    }

    const conteudoModal = $("previewModalContent");
    const fecharModalButton = $("fecharPreviewModal");
    const tocarModalButton = $("previewModalPlay");
    const tempoModal = $("previewModalTempo");

    if (!conteudoModal || !fecharModalButton || !tocarModalButton || !tempoModal) {
      console.warn("Lyric Studio: controles da prévia não encontrados.");
      return;
    }

    const paiOriginal = preview.parentNode;
    const proximoOriginal = preview.nextSibling;

    let modalAberto = false;
    let focoAnterior = null;

    function formatarTempoModal(segundos) {
      if (!Number.isFinite(segundos) || segundos < 0) segundos = 0;

      const minutos = Math.floor(segundos / 60);
      const segundosRestantes = Math.floor(segundos % 60);
      return String(minutos).padStart(2, "0") + ":" + String(segundosRestantes).padStart(2, "0");
    }

    function atualizarTempoModal() {
      if (!audioEl) return;
      tempoModal.textContent =
        formatarTempoModal(audioEl.currentTime || 0) + " / " + formatarTempoModal(audioEl.duration);
    }

    function atualizarBotaoAudio() {
      if (!audioEl) return;
      tocarModalButton.textContent = audioEl.paused ? "▶ Reproduzir áudio" : "Ⅱ Pausar áudio";
    }

    function abrirModal() {
      if (modalAberto) return;

      focoAnterior = document.activeElement;
      modalAberto = true;

      conteudoModal.appendChild(preview);
      modal.classList.add("aberto");
      document.body.style.overflow = "hidden";

      atualizarTempoModal();
      atualizarBotaoAudio();
      fecharModalButton.focus();
    }

    function fecharModal() {
      if (!modalAberto) return;

      modalAberto = false;
      modal.classList.remove("aberto");
      document.body.style.overflow = "";

      if (paiOriginal && paiOriginal.isConnected) {
        if (proximoOriginal && proximoOriginal.parentNode === paiOriginal) {
          paiOriginal.insertBefore(preview, proximoOriginal);
        } else {
          paiOriginal.appendChild(preview);
        }
      }

      if (focoAnterior && typeof focoAnterior.focus === "function") {
        focoAnterior.focus();
      }
    }

    abrirPreviewButton.addEventListener("click", abrirModal);
    fecharModalButton.addEventListener("click", fecharModal);

    modal.addEventListener("click", event => {
      if (event.target === modal) fecharModal();
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && modalAberto) {
        fecharModal();
      }
    });

    if (audioEl) {
      tocarModalButton.addEventListener("click", async () => {
        try {
          if (audioEl.paused) {
            if (typeof prepararAudioContext === "function") prepararAudioContext();

            if (typeof audioContext !== "undefined" && audioContext && audioContext.state === "suspended") {
              await audioContext.resume();
            }

            await audioEl.play();
          } else {
            audioEl.pause();
          }
        } catch (erro) {
          console.error("Não foi possível reproduzir o áudio:", erro);
        }

        atualizarBotaoAudio();
      });

      ["timeupdate", "durationchange", "loadedmetadata", "seeked"].forEach(evento => {
        audioEl.addEventListener(evento, atualizarTempoModal);
      });

      ["play", "pause", "ended"].forEach(evento => {
        audioEl.addEventListener(evento, atualizarBotaoAudio);
      });
    }

    console.info("Lyric Studio: gavetas, subgavetas e prévia inicializadas.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciarNovaInterface, { once: true });
  } else {
    iniciarNovaInterface();
  }
})();

/* =========================================================
   ANIMAÇÕES DE ADESIVOS
========================================================= */

(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  const camposAnimacao = [
    "animacaoEntrada",
    "animacaoLoop",
    "animacaoSaida",
    "animacaoInicio",
    "animacaoFim",
    "animacaoVelocidade"
  ];

  function adesivoAtual() {
    return elementosVisuais.find(item => item.id === imagemSelecionada) || null;
  }

  function informarAnimacao(texto) {
    const estado = $("estadoAnimacao");
    if (estado) estado.textContent = texto;
  }

  function carregarControlesAnimacao(item) {
    if (!item) {
      informarAnimacao("Selecione um adesivo para configurar suas animações.");
      return;
    }

    const anim = item.animacao || {};

    $("animacaoEntrada").value = anim.entrada || "none";
    $("animacaoLoop").value = anim.loop || "none";
    $("animacaoSaida").value = anim.saida || "none";
    $("animacaoInicio").value = anim.inicio ?? 0;
    $("animacaoFim").value = anim.fim ?? 0;
    $("animacaoVelocidade").value = anim.velocidade ?? 1;

    informarAnimacao(
      anim.entrada !== "none" || anim.loop !== "none" || anim.saida !== "none"
        ? "Animações carregadas para: " + item.nome
        : "Nenhuma animação configurada para: " + item.nome
    );
  }

  window.carregarControlesAnimacaoAdesivo = carregarControlesAnimacao;

  function aplicarAnimacao() {
    const item = adesivoAtual();

    if (!item) {
      informarAnimacao("Adicione ou selecione um adesivo primeiro.");
      return;
    }

    const inicio = Math.max(0, Number($("animacaoInicio").value) || 0);
    const fim = Math.max(0, Number($("animacaoFim").value) || 0);

    if (fim > 0 && fim <= inicio) {
      informarAnimacao("O tempo final precisa ser maior que o inicial.");
      return;
    }

    item.animacao = {
      entrada: $("animacaoEntrada").value,
      loop: $("animacaoLoop").value,
      saida: $("animacaoSaida").value,
      inicio,
      fim,
      velocidade: Math.max(0.1, Number($("animacaoVelocidade").value) || 1)
    };

    informarAnimacao("Animações aplicadas ao adesivo selecionado.");
    renderizar();
  }

  function limparAnimacao() {
    const item = adesivoAtual();

    if (!item) {
      informarAnimacao("Selecione um adesivo primeiro.");
      return;
    }

    item.animacao = {
      entrada: "none",
      loop: "none",
      saida: "none",
      inicio: 0,
      fim: 0,
      velocidade: 1
    };

    carregarControlesAnimacao(item);
    informarAnimacao("As animações deste adesivo foram removidas.");
    renderizar();
  }

  function obterTransformacaoAnimada(item, tempo) {
    const anim = item.animacao || {};
    const velocidade = Math.max(0.1, Number(anim.velocidade) || 1);
    const inicio = Math.max(0, Number(anim.inicio) || 0);
    const fimConfigurado = Math.max(0, Number(anim.fim) || 0);

    const duracaoAudio = Number(audio.duration);
    const fim = fimConfigurado > 0
      ? fimConfigurado
      : (Number.isFinite(duracaoAudio) && duracaoAudio > 0 ? duracaoAudio : Infinity);

    if (tempo < inicio || tempo >= fim) {
      return { alpha: 0, escala: 1, dx: 0, dy: 0, rotacao: 0 };
    }

    const tempoLocal = (tempo - inicio) * velocidade;
    const entradaDuracao = 0.65;
    const saidaDuracao = 0.5;
    const restante = fim - tempo;

    let alpha = 1;
    let escala = 1;
    let dx = 0;
    let dy = 0;
    let rotacao = 0;

    const entrada = anim.entrada || "none";
    const saida = anim.saida || "none";
    const loop = anim.loop || "none";

    if (tempoLocal < entradaDuracao) {
      const p = Math.min(1, tempoLocal / entradaDuracao);

      if (entrada === "fade") {
        alpha = p;
      } else if (entrada === "zoom") {
        escala *= 0.2 + 0.8 * p;
      } else if (entrada === "bounce") {
        escala *= 0.65 + 0.35 * p + Math.sin(p * Math.PI) * 0.25;
        dy -= Math.sin(p * Math.PI) * 35;
      } else if (entrada === "slide") {
        dy += (1 - p) * 100;
        alpha = p;
      } else if (entrada === "spin") {
        rotacao += (1 - p) * Math.PI * 2;
        escala *= 0.5 + 0.5 * p;
      }
    }

    if (Number.isFinite(restante) && restante < saidaDuracao) {
      const p = Math.max(0, restante / saidaDuracao);

      if (saida === "fade") {
        alpha *= p;
      } else if (saida === "shrink") {
        escala *= p;
        alpha *= p;
      } else if (saida === "zoomOut") {
        escala *= 1 + (1 - p) * 1.5;
        alpha *= p;
      }
    }

    const fase = tempoLocal * Math.PI * 2;

    if (loop === "rotate") {
      rotacao += tempoLocal * Math.PI;
    } else if (loop === "float") {
      dy += Math.sin(fase) * 12;
    } else if (loop === "swing") {
      rotacao += Math.sin(fase) * 0.18;
    } else if (loop === "pulse") {
      escala *= 1 + Math.sin(fase) * 0.08;
    } else if (loop === "shake") {
      dx += Math.sin(tempoLocal * 35) * 4;
      dy += Math.cos(tempoLocal * 29) * 3;
    }

    return { alpha, escala, dx, dy, rotacao };
  }

  window.desenharAdesivoAnimado = function (item, tempo) {
    if (!item.imagem || !item.imagem.complete) return;

    const animacao = obterTransformacaoAnimada(item, tempo);
    if (animacao.alpha <= 0) return;

    const escalaBase = (Number(item.escala) || 100) / 100;
    const largura = item.largura * escalaBase * animacao.escala;
    const altura = item.altura * escalaBase * animacao.escala;

    ctx.save();
    ctx.globalAlpha *= animacao.alpha;
    ctx.translate(item.x + animacao.dx, item.y + animacao.dy);

    ctx.rotate(
      (Number(item.rotacao) || 0) * Math.PI / 180 + animacao.rotacao
    );

    ctx.drawImage(item.imagem, -largura / 2, -altura / 2, largura, altura);

    if (!exportando && item.id === imagemSelecionada) {
      ctx.strokeStyle = "#72f0b0";
      ctx.lineWidth = Math.max(1, canvas.width / 720);
      ctx.setLineDash([7, 5]);
      ctx.strokeRect(-largura / 2, -altura / 2, largura, altura);
      ctx.setLineDash([]);
    }

    ctx.restore();
  };

  function configurarControlesAnimacao() {
    $("aplicarAnimacao")?.addEventListener("click", aplicarAnimacao);
    $("limparAnimacao")?.addEventListener("click", limparAnimacao);

    camposAnimacao.forEach(id => {
      $(id)?.addEventListener("change", () => {
        const item = adesivoAtual();

        if (item) {
          informarAnimacao("Configurações alteradas. Clique em Aplicar animação.");
        }
      });
    });

    $("arquivoImagem")?.addEventListener("change", () => {
      setTimeout(() => {
        const item = adesivoAtual();
        if (item) carregarControlesAnimacao(item);
      }, 100);
    });

    $("centralizarImagem")?.addEventListener("click", () => {
      const item = adesivoAtual();
      if (item) carregarControlesAnimacao(item);
    });

    $("excluirImagem")?.addEventListener("click", () => {
      setTimeout(() => {
        const item = adesivoAtual();

        if (item) carregarControlesAnimacao(item);
        else informarAnimacao("Selecione um adesivo para animá-lo.");
      }, 50);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", configurarControlesAnimacao, { once: true });
  } else {
    configurarControlesAnimacao();
  }
})();

/* =========================================================
   ONDAS: forma de onda + bandeja
   Nada é sincronizado sozinho. As legendas começam na bandeja
   e só entram na onda quando você as arrasta (ou marca o tempo).
   Cada legenda: { id, texto, linha, parte, inicio, fim, naOnda }
========================================================= */

(() => {
  "use strict";

  const BIN_MS = 5;
  const ALTURA = 240;
  const ALTURA_REGUA = 18;
  const Y_FAIXA = 22;
  const ALTURA_FAIXA = 26;
  const RAIO_TOQUE = 16;
  const MIN_DURACAO = 0.05;

  /* Tamanho inicial de uma legenda ao soltar na onda (você ajusta o fim depois). */
  const SEGUNDOS_POR_PALAVRA = 0.4;
  const DURACAO_MINIMA_PADRAO = 0.6;

  let aberto = false;
  let picos = null;
  let picosSrc = null;
  let binSeg = BIN_MS / 1000;
  let picoMaximo = 1;
  let duracaoOnda = 0;
  let carregando = false;
  let inicioVisivel = 0;
  let janela = 15;
  let precisaDesenhar = true;
  let arraste = null;
  let arrasteBandeja = null;
  let rafOndas = null;
  let tocarLinhaFim = null;
  let focoAnterior = null;
  let ultimoTempo = -1;
  let ultimoQuadro = 0;
  let indicePainel = -2;
  let desfazerSeparacao = null;

  const el = id => document.getElementById(id);
  const naOnda = l => !!l && l.naOnda === true;
  const textoLimpo = l => String(l.texto || "").replace(/\s+/g, " ");
  const quantidadePalavras = l => palavrasDaLegenda(l && l.texto).length;

  /* ---------- Utilidades ---------- */

  function formatar(t) {
    if (!Number.isFinite(t) || t < 0) t = 0;
    const cs = Math.round(t * 100);
    const m = Math.floor(cs / 6000);
    const s = (cs % 6000) / 100;
    return String(m).padStart(2, "0") + ":" + s.toFixed(2).padStart(5, "0");
  }

  function duracaoTotal() {
    if (Number.isFinite(audio.duration) && audio.duration > 0) return audio.duration;
    return duracaoOnda;
  }

  function maxInicioVisivel() {
    return Math.max(0, duracaoTotal() - janela);
  }

  function aviso(texto) {
    const status = el("ondasStatus");
    if (status) status.textContent = texto;
    mensagem(texto);
  }

  function novaLegenda(texto, linha, parte) {
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random(),
      texto,
      linha,
      parte: !!parte,
      inicio: 0,
      fim: 0,
      naOnda: false
    };
  }

  /* ---------- Colocar, mover e tirar da onda ---------- */

  function duracaoPadrao(legenda) {
    return Math.max(DURACAO_MINIMA_PADRAO, quantidadePalavras(legenda) * SEGUNDOS_POR_PALAVRA);
  }

  function colocar(legenda, tempo) {
    const total = duracaoTotal();
    let inicio = Math.max(0, tempo);
    if (total > 0) inicio = Math.min(inicio, Math.max(0, total - MIN_DURACAO));

    let fim = inicio + duracaoPadrao(legenda);
    if (total > 0) fim = Math.min(fim, total);
    if (fim - inicio < MIN_DURACAO) fim = inicio + MIN_DURACAO;

    legenda.inicio = inicio;
    legenda.fim = fim;
    legenda.naOnda = true;
  }

  function tirarDaOnda(legenda) {
    legenda.inicio = 0;
    legenda.fim = 0;
    legenda.naOnda = false;
  }

  function moverInicio(legenda, novo) {
    if (!naOnda(legenda)) return;
    legenda.inicio = limitar(novo, 0, legenda.fim - MIN_DURACAO);
  }

  function moverFim(legenda, novo) {
    if (!naOnda(legenda)) return;
    const total = duracaoTotal();
    legenda.fim = limitar(novo, legenda.inicio + MIN_DURACAO, total > 0 ? Math.max(total, legenda.inicio + MIN_DURACAO) : Infinity);
  }

  function moverBloco(bloco, deslocamento) {
    const { legenda, inicio0, fim0 } = bloco;
    const duracao = fim0 - inicio0;
    const total = duracaoTotal();

    let inicio = Math.max(0, inicio0 + deslocamento);
    if (total > duracao) inicio = Math.min(inicio, total - duracao);

    legenda.inicio = inicio;
    legenda.fim = inicio + duracao;
  }

  /* ---------- Letra e separação em palavras ---------- */

  function criarLinhas() {
    const linhas = el("ondasLetra").value
      .split(/\r?\n/)
      .map(linha => linha.trim())
      .filter(Boolean);

    if (!linhas.length) {
      aviso("Cole a letra antes de criar as linhas.");
      return;
    }

    if (legendas.length && !window.confirm("Substituir as legendas atuais pela nova letra?")) return;

    legendas = linhas.map((texto, i) => novaLegenda(texto, i + 1, false));
    indiceSelecionado = 0;
    desfazerSeparacao = null;

    el("ondasLetraBox").open = false;
    aposEdicao();
    aviso(linhas.length + " linhas na bandeja. Arraste cada uma até a onda.");
  }

  /* Cada linha vira uma legenda por palavra. "Separar tudo" só mexe no que ainda
     está na bandeja; a linha selecionada é separada mesmo que já esteja na onda
     e, nesse caso, as palavras continuam na onda dentro do mesmo trecho. */
  function separar(somenteSelecionada) {
    const selecionada = legendas[indiceSelecionado] || null;

    const alvo = new Set(legendas.filter(l =>
      quantidadePalavras(l) > 1 && (somenteSelecionada ? l === selecionada : !naOnda(l))
    ));

    if (!alvo.size) {
      aviso(somenteSelecionada
        ? "Selecione uma linha com mais de uma palavra."
        : "Não há linhas com mais de uma palavra na bandeja.");
      return;
    }

    desfazerSeparacao = { lista: legendas.slice(), indice: indiceSelecionado };

    const nova = [];
    let novoIndice = -1;

    legendas.forEach((legenda, i) => {
      if (!alvo.has(legenda)) {
        if (i === indiceSelecionado) novoIndice = nova.length;
        nova.push(legenda);
        return;
      }

      const palavras = palavrasDaLegenda(legenda.texto);

      /* Linha já sincronizada: as palavras ficam na onda, dentro do mesmo
         trecho, com o tempo dividido pelo tamanho de cada palavra. */
      let limites = null;
      if (naOnda(legenda)) {
        const total = legenda.fim - legenda.inicio;
        const pesos = palavras.map(pl => Math.max(2, pl.length) + 1);
        const somaPesos = pesos.reduce((x, y) => x + y, 0);
        const igual = total / palavras.length < MIN_DURACAO;
        let cursor = legenda.inicio;

        limites = pesos.map((peso, k) => {
          const inicio = cursor;
          const fim = k === palavras.length - 1
            ? legenda.fim
            : cursor + (igual ? total / palavras.length : (total * peso) / somaPesos);
          cursor = fim;
          return { inicio, fim };
        });
      }

      palavras.forEach((palavra, k) => {
        if (i === indiceSelecionado && k === 0) novoIndice = nova.length;
        const parte = novaLegenda(palavra, legenda.linha || i + 1, true);
        if (limites) {
          parte.inicio = limites[k].inicio;
          parte.fim = limites[k].fim;
          parte.naOnda = true;
        }
        nova.push(parte);
      });
    });

    legendas = nova;
    indiceSelecionado = novoIndice >= 0 ? novoIndice : 0;

    aposEdicao();
    aviso(alvo.size + (alvo.size === 1 ? " linha separada" : " linhas separadas") + " em palavras." +
      (somenteSelecionada && selecionada && naOnda(selecionada)
        ? " As palavras ficaram na onda, no mesmo trecho. Ajuste o tempo de cada uma."
        : " Arraste cada palavra até a onda."));
  }

  function desfazerSepararPalavras() {
    if (!desfazerSeparacao) return;

    legendas = desfazerSeparacao.lista;
    indiceSelecionado = Math.min(desfazerSeparacao.indice, legendas.length - 1);
    desfazerSeparacao = null;

    aposEdicao();
    aviso("Separação desfeita: as linhas originais voltaram.");
  }

  function tirarSelecionada() {
    const legenda = legendas[indiceSelecionado];
    if (!naOnda(legenda)) return;

    tirarDaOnda(legenda);
    aposEdicao();
  }

  function tirarTodas() {
    if (!legendas.some(naOnda)) return;
    if (!window.confirm("Tirar todas as legendas da onda e devolver à bandeja?")) return;

    legendas.forEach(tirarDaOnda);
    aposEdicao();
    aviso("A onda está limpa. Tudo voltou para a bandeja.");
  }

  /* ---------- Forma de onda ---------- */

  async function carregarPicos() {
    if (!audio.src) return;
    if (picos && picosSrc === audio.src) return;
    if (carregando) return;

    carregando = true;
    aviso("Lendo a forma de onda...");

    try {
      const buffer = await carregarAudioBuffer();
      const passo = Math.max(1, Math.round(buffer.sampleRate * BIN_MS / 1000));
      const total = Math.ceil(buffer.length / passo);
      const lista = new Float32Array(total);

      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const dados = buffer.getChannelData(c);

        for (let b = 0; b < total; b++) {
          const inicio = b * passo;
          const fim = Math.min(buffer.length, inicio + passo);
          let maior = lista[b];

          for (let k = inicio; k < fim; k++) {
            const v = dados[k] < 0 ? -dados[k] : dados[k];
            if (v > maior) maior = v;
          }

          lista[b] = maior;
        }
      }

      let maximo = 0;
      for (let b = 0; b < total; b++) if (lista[b] > maximo) maximo = lista[b];

      picos = lista;
      picosSrc = audio.src;
      binSeg = passo / buffer.sampleRate;
      picoMaximo = maximo > 0.0001 ? maximo : 1;
      duracaoOnda = buffer.duration;

      aviso("");
    } catch (erro) {
      picos = null;
      aviso("Não foi possível ler a forma de onda deste áudio. Os botões de ajuste continuam funcionando.");
    } finally {
      carregando = false;
      precisaDesenhar = true;
      atualizarSliders();
    }
  }

  function xDeTempo(t, largura) {
    return ((t - inicioVisivel) / janela) * largura;
  }

  function tempoDeX(x, largura) {
    return inicioVisivel + (x / largura) * janela;
  }

  function desenharEtiqueta(c, texto, x, y, cor, largura) {
    c.font = "bold 11px system-ui, sans-serif";
    const larguraTexto = c.measureText(texto).width + 12;
    const posX = Math.min(largura - larguraTexto - 2, Math.max(2, x - larguraTexto / 2));

    c.fillStyle = "rgba(0,0,0,0.85)";
    c.fillRect(posX, y, larguraTexto, 18);
    c.fillStyle = cor;
    c.textAlign = "left";
    c.fillText(texto, posX + 6, y + 9);
  }

  function desenharOnda() {
    const canvasOndas = el("ondasCanvas");
    if (!canvasOndas) return;

    const largura = canvasOndas.clientWidth;
    if (!largura) return;

    const dpr = window.devicePixelRatio || 1;
    const larguraPx = Math.round(largura * dpr);
    const alturaPx = Math.round(ALTURA * dpr);

    if (canvasOndas.width !== larguraPx || canvasOndas.height !== alturaPx) {
      canvasOndas.width = larguraPx;
      canvasOndas.height = alturaPx;
    }

    const c = canvasOndas.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, largura, ALTURA);
    c.fillStyle = "#0c121a";
    c.fillRect(0, 0, largura, ALTURA);

    const duracao = duracaoTotal();
    const fimVisivel = inicioVisivel + janela;

    /* Régua de tempo */
    const passos = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60];
    let passoRegua = passos[passos.length - 1];
    for (const candidato of passos) {
      if ((candidato / janela) * largura >= 64) { passoRegua = candidato; break; }
    }

    c.font = "10px system-ui, sans-serif";
    c.textBaseline = "middle";
    c.textAlign = "left";
    c.strokeStyle = "rgba(145,160,177,0.35)";
    c.fillStyle = "#91a0b1";
    c.lineWidth = 1;

    for (let t = Math.ceil(inicioVisivel / passoRegua) * passoRegua; t <= fimVisivel; t += passoRegua) {
      const x = Math.round(xDeTempo(t, largura)) + 0.5;
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, ALTURA_REGUA - 4);
      c.stroke();
      const minutos = Math.floor(t / 60);
      const segundos = t - minutos * 60;
      const rotulo = String(minutos).padStart(2, "0") + ":" +
        (passoRegua < 1 ? segundos.toFixed(1).padStart(4, "0") : String(Math.round(segundos)).padStart(2, "0"));
      c.fillText(rotulo, x + 3, ALTURA_REGUA / 2);
    }

    /* Forma de onda */
    const topo = Y_FAIXA + ALTURA_FAIXA + 8;
    const fundo = ALTURA - 28;
    const meio = (topo + fundo) / 2;
    const meiaAltura = (fundo - topo) / 2;
    const selecionada = naOnda(legendas[indiceSelecionado]) ? legendas[indiceSelecionado] : null;

    if (picos) {
      let corAtual = "";

      for (let x = 0; x < largura; x++) {
        const t0 = inicioVisivel + (x / largura) * janela;
        const t1 = inicioVisivel + ((x + 1) / largura) * janela;

        if (t1 < 0 || t0 > duracao) continue;

        const i0 = Math.max(0, Math.floor(t0 / binSeg));
        const i1 = Math.min(picos.length, Math.max(i0 + 1, Math.ceil(t1 / binSeg)));
        let maior = 0;

        for (let i = i0; i < i1; i++) if (picos[i] > maior) maior = picos[i];

        const altura = Math.max(1, Math.pow(maior / picoMaximo, 0.6) * meiaAltura);
        const tm = (t0 + t1) / 2;
        const dentro = selecionada && tm >= selecionada.inicio && tm < selecionada.fim;
        const cor = dentro ? "#72f0b0" : "#5b7b99";

        if (cor !== corAtual) { c.fillStyle = cor; corAtual = cor; }
        c.fillRect(x, meio - altura, 1, altura * 2);
      }
    } else {
      c.fillStyle = "#33465a";
      c.fillRect(0, meio, largura, 1);
      c.fillStyle = "#91a0b1";
      c.textAlign = "center";
      c.fillText(carregando ? "Lendo a forma de onda..." : "Forma de onda indisponível", largura / 2, meio - 12);
      c.textAlign = "left";
    }

    /* Legendas que já estão na onda */
    legendas.forEach((legenda, i) => {
      if (!naOnda(legenda)) return;
      if (legenda.fim < inicioVisivel || legenda.inicio > fimVisivel) return;

      const x1 = xDeTempo(legenda.inicio, largura);
      const x2 = xDeTempo(legenda.fim, largura);
      const largBloco = Math.max(1, x2 - x1);
      const sel = i === indiceSelecionado;

      c.fillStyle = sel ? "rgba(114,240,176,0.28)" : "rgba(110,160,230,0.20)";
      c.fillRect(x1, Y_FAIXA, largBloco, ALTURA_FAIXA);
      c.strokeStyle = sel ? "#72f0b0" : "rgba(150,190,240,0.5)";
      c.lineWidth = 1;
      c.strokeRect(x1 + 0.5, Y_FAIXA + 0.5, largBloco - 1, ALTURA_FAIXA - 1);

      c.save();
      c.beginPath();
      c.rect(x1, Y_FAIXA, largBloco, ALTURA_FAIXA);
      c.clip();
      c.fillStyle = "#edf3f8";
      c.font = "11px system-ui, sans-serif";
      c.textAlign = "left";
      c.fillText(legenda.parte ? textoLimpo(legenda) : (i + 1) + ". " + textoLimpo(legenda), x1 + 9, Y_FAIXA + ALTURA_FAIXA / 2);
      c.restore();

      c.lineWidth = sel ? 2 : 1;
      c.strokeStyle = sel ? "#72f0b0" : "rgba(114,240,176,0.5)";
      c.beginPath();
      c.moveTo(x1, Y_FAIXA);
      c.lineTo(x1, ALTURA);
      c.stroke();

      c.strokeStyle = sel ? "#ffb454" : "rgba(255,180,84,0.5)";
      c.beginPath();
      c.moveTo(x2, Y_FAIXA);
      c.lineTo(x2, ALTURA);
      c.stroke();

      const raio = sel ? 8 : 5.5;

      c.fillStyle = "#72f0b0";
      c.beginPath();
      c.arc(x1, Y_FAIXA + ALTURA_FAIXA / 2, raio, 0, Math.PI * 2);
      c.fill();

      c.fillStyle = "#ffb454";
      c.beginPath();
      c.arc(x2, ALTURA - 16, raio, 0, Math.PI * 2);
      c.fill();
    });

    /* Tempo da alça enquanto ela é arrastada */
    if (arraste && arraste.alca && arraste.moveu) {
      const { legenda, tipo } = arraste.alca;
      const valor = tipo === "inicio" ? legenda.inicio : legenda.fim;

      desenharEtiqueta(
        c,
        formatar(valor),
        xDeTempo(valor, largura),
        tipo === "inicio" ? Y_FAIXA + ALTURA_FAIXA + 4 : ALTURA - 52,
        tipo === "inicio" ? "#72f0b0" : "#ffb454",
        largura
      );
    }

    /* Guia de soltura ao arrastar um item da bandeja */
    if (arrasteBandeja && arrasteBandeja.ativo && arrasteBandeja.tempo !== null) {
      const xGuia = xDeTempo(arrasteBandeja.tempo, largura);

      c.setLineDash([5, 4]);
      c.strokeStyle = "#ffffff";
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(xGuia, 0);
      c.lineTo(xGuia, ALTURA);
      c.stroke();
      c.setLineDash([]);

      desenharEtiqueta(c, formatar(arrasteBandeja.tempo), xGuia, ALTURA - 24, "#ffffff", largura);
    }

    /* Posição de reprodução */
    const xAgora = xDeTempo(audio.currentTime || 0, largura);

    if (xAgora >= -2 && xAgora <= largura + 2) {
      c.strokeStyle = "#ffffff";
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(xAgora, 0);
      c.lineTo(xAgora, ALTURA);
      c.stroke();
      c.fillStyle = "#ffffff";
      c.beginPath();
      c.moveTo(xAgora - 5, 0);
      c.lineTo(xAgora + 5, 0);
      c.lineTo(xAgora, 8);
      c.closePath();
      c.fill();
    }
  }

  /* ---------- Interface ---------- */

  function montar() {
    if (el("ondasModal")) return;

    const modal = document.createElement("div");
    modal.id = "ondasModal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "ondasTitulo");

    modal.innerHTML = `
      <div class="ondas-card">
        <div class="ondas-header">
          <h2 id="ondasTitulo">Ondas</h2>
          <span id="ondasStatus" class="ondas-status"></span>
          <button id="fecharOndas" type="button" aria-label="Fechar Ondas">×</button>
        </div>

        <div class="ondas-agora" id="ondasAgora">—</div>

        <div class="ondas-wave-wrap">
          <canvas id="ondasCanvas"></canvas>
        </div>

        <p class="ondas-dica">
          Arraste um item da bandeja até a onda para marcar onde ele começa. Na onda, a bolinha verde (em cima)
          é o início e a laranja (embaixo) é o fim: arraste para ajustar. Arraste o bloco para mover tudo junto.
          Arraste a parte de baixo da onda para andar no tempo e toque nela para posicionar o áudio.
        </p>

        <div class="ondas-controles">
          <button id="ondasPlay" type="button" class="secondary-button">▶ Tocar</button>
          <span id="ondasTempo" class="ondas-tempo">00:00.00</span>
          <label class="ondas-slider">Zoom
            <input id="ondasZoom" type="range" min="0" max="100" value="46">
          </label>
          <label class="ondas-slider">Posição
            <input id="ondasPos" type="range" min="0" max="1000" value="0">
          </label>
        </div>

        <div class="ondas-bandeja" id="ondasBandeja">
          <details id="ondasLetraBox" class="ondas-letra">
            <summary>Letra da música</summary>
            <textarea
              id="ondasLetra"
              rows="6"
              placeholder="Cole aqui a letra, com cada verso em uma linha..."
            ></textarea>
            <div class="ondas-botoes">
              <button id="ondasCriarLinhas" type="button" class="primary-button">Criar linhas na bandeja</button>
            </div>
          </details>

          <div class="ondas-bandeja-topo">
            <strong>Bandeja</strong>
            <span id="ondasContagem" class="ondas-contagem"></span>
            <button id="ondasSepararTodas" type="button" class="secondary-button">Separar tudo em palavras</button>
            <button id="ondasSepararSel" type="button" class="secondary-button">Separar a selecionada</button>
            <button id="ondasSepararDesfazer" type="button" class="secondary-button">Desfazer separação</button>
          </div>
          <p class="ondas-bandeja-dica" id="ondasBandejaDica"></p>
          <div class="ondas-bandeja-itens" id="ondasBandejaItens" role="list"></div>
        </div>

        <div class="ondas-secao">
          <div class="ondas-secao-titulo">Legenda selecionada</div>

          <div class="ondas-nav">
            <button id="ondasAnterior" type="button" class="secondary-button" aria-label="Legenda anterior">◀</button>
            <div id="ondasTextoSel" class="ondas-texto-sel">Nenhuma legenda selecionada</div>
            <button id="ondasProxima" type="button" class="secondary-button" aria-label="Próxima legenda">▶</button>
          </div>

          <div class="ondas-ajustes">
            <div class="ondas-par">
              <span class="ondas-par-nome">Início</span>
              <button type="button" class="secondary-button" data-ajuste="inicio" data-sinal="-1">−</button>
              <output id="ondasValInicio">--</output>
              <button type="button" class="secondary-button" data-ajuste="inicio" data-sinal="1">+</button>
              <button type="button" id="ondasInicioAgora" class="secondary-button">= agora</button>
            </div>

            <div class="ondas-par">
              <span class="ondas-par-nome">Fim</span>
              <button type="button" class="secondary-button" data-ajuste="fim" data-sinal="-1">−</button>
              <output id="ondasValFim">--</output>
              <button type="button" class="secondary-button" data-ajuste="fim" data-sinal="1">+</button>
              <button type="button" id="ondasFimAgora" class="secondary-button">= agora</button>
            </div>

            <label class="ondas-passo">Passo
              <select id="ondasPasso">
                <option value="0.05">0,05 s</option>
                <option value="0.1" selected>0,1 s</option>
                <option value="0.25">0,25 s</option>
                <option value="0.5">0,5 s</option>
              </select>
            </label>
          </div>

          <div class="ondas-botoes">
            <button id="ondasTocarLinha" type="button" class="secondary-button">▶ Tocar esta legenda</button>
            <button id="ondasTirar" type="button" class="secondary-button">Tirar da onda</button>
            <button id="ondasTirarTodas" type="button" class="danger-button">Tirar todas da onda</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    ligarEventos();
  }

  function atualizarSliders() {
    const zoom = el("ondasZoom");
    const pos = el("ondasPos");
    if (!zoom || !pos) return;

    zoom.value = String(Math.round(100 * Math.log(janela / 60) / Math.log(0.05)));

    const maximo = maxInicioVisivel();
    pos.value = maximo > 0 ? String(Math.round((inicioVisivel / maximo) * 1000)) : "0";
  }

  /* A bandeja mostra só o que ainda não está na onda. */
  function atualizarBandeja() {
    const itens = el("ondasBandejaItens");
    if (!itens) return;

    const rolagem = itens.scrollLeft;
    itens.textContent = "";

    const naBandeja = [];
    legendas.forEach((legenda, i) => { if (!naOnda(legenda)) naBandeja.push(i); });

    el("ondasContagem").textContent =
      naBandeja.length + " na bandeja · " + (legendas.length - naBandeja.length) + " na onda";

    el("ondasBandejaDica").textContent = naBandeja.length
      ? "Arraste cada item até a onda. Toque num item para selecioná-lo."
      : legendas.length
        ? "Tudo já está na onda. Selecione uma legenda e use “Tirar da onda” para devolvê-la à bandeja."
        : "Cole a letra acima e toque em “Criar linhas na bandeja”.";

    let ultimaLinha = null;

    naBandeja.forEach(i => {
      const legenda = legendas[i];
      const linha = legenda.linha || i + 1;

      if (legenda.parte && linha !== ultimaLinha) {
        const grupo = document.createElement("span");
        grupo.className = "ondas-grupo";
        grupo.title = "Palavras da linha " + linha;
        grupo.textContent = String(linha);
        itens.appendChild(grupo);
      }

      ultimaLinha = linha;

      const chip = document.createElement("div");
      chip.className = "ondas-chip" + (legenda.parte ? " palavra" : "") + (i === indiceSelecionado ? " selecionada" : "");
      chip.dataset.i = String(i);
      chip.setAttribute("role", "listitem");

      const rotulo = document.createElement("span");
      rotulo.className = "texto";
      rotulo.textContent = legenda.parte ? textoLimpo(legenda) : linha + ". " + textoLimpo(legenda);

      chip.appendChild(rotulo);
      itens.appendChild(chip);
    });

    itens.scrollLeft = rolagem;
  }

  function destacarSelecionadaNaBandeja() {
    const itens = el("ondasBandejaItens");
    if (!itens) return;

    itens.querySelectorAll(".ondas-chip").forEach(chip => {
      chip.classList.toggle("selecionada", Number(chip.dataset.i) === indiceSelecionado);
    });
  }

  function atualizarPainel() {
    indicePainel = indiceSelecionado;

    if (!arraste && !arrasteBandeja) atualizarBandeja();
    else destacarSelecionadaNaBandeja();

    const legenda = legendas[indiceSelecionado] || null;
    const colocada = naOnda(legenda);

    const textoSel = el("ondasTextoSel");
    if (!textoSel) return;

    if (legenda) {
      textoSel.textContent = (indiceSelecionado + 1) + ". " + textoLimpo(legenda) + (colocada ? "" : "  (na bandeja)");
    } else {
      textoSel.textContent = legendas.length
        ? "Toque numa legenda para selecionar."
        : "Cole a letra para começar.";
    }

    el("ondasValInicio").textContent = colocada ? formatar(legenda.inicio) : "--";
    el("ondasValFim").textContent = colocada ? formatar(legenda.fim) : "--";

    el("ondasModal").querySelectorAll("[data-ajuste], #ondasFimAgora, #ondasTocarLinha, #ondasTirar")
      .forEach(botao => { botao.disabled = !colocada; });

    el("ondasInicioAgora").disabled = !legenda;
    el("ondasAnterior").disabled = !(indiceSelecionado > 0);
    el("ondasProxima").disabled = !(indiceSelecionado >= 0 && indiceSelecionado < legendas.length - 1);

    el("ondasSepararSel").disabled = !(legenda && quantidadePalavras(legenda) > 1);
    el("ondasSepararTodas").disabled = !legendas.some(l => !naOnda(l) && quantidadePalavras(l) > 1);
    el("ondasSepararDesfazer").disabled = !desfazerSeparacao;
    el("ondasTirarTodas").disabled = !legendas.some(naOnda);

    atualizarContador();
  }

  function atualizarRotulos(t) {
    const tempo = el("ondasTempo");
    const agora = el("ondasAgora");
    const play = el("ondasPlay");
    if (!tempo) return;

    tempo.textContent = formatar(t) + " / " + formatar(duracaoTotal());
    play.textContent = audio.paused ? "▶ Tocar" : "Ⅱ Pausar";

    const ativa = linhaAtiva(t);
    agora.textContent = ativa ? "Agora: " + textoLimpo(ativa) : "Agora: (sem legenda)";
  }

  function selecionar(i) {
    indiceSelecionado = i;
    renderizar();
    atualizarPainel();
    precisaDesenhar = true;
  }

  function irParaLegenda(i) {
    if (i < 0 || i >= legendas.length) return;

    selecionar(i);

    if (naOnda(legendas[i])) {
      inicioVisivel = limitar(legendas[i].inicio - janela * 0.25, 0, maxInicioVisivel());
      atualizarSliders();
    }
  }

  /* ---------- Bandeja: arrastar até a onda ---------- */

  function posicaoNaOnda(clientX, clientY) {
    const canvasOndas = el("ondasCanvas");
    const r = canvasOndas.getBoundingClientRect();
    const dentro = clientX >= r.left && clientX <= r.right && clientY >= r.top - 60 && clientY <= r.bottom + 8;

    return dentro
      ? { tempo: tempoDeX(clientX - r.left, r.width), relativo: (clientX - r.left) / r.width }
      : null;
  }

  function encerrarArrasteBandeja() {
    if (!arrasteBandeja) return;

    if (arrasteBandeja.fantasma) arrasteBandeja.fantasma.remove();
    if (arrasteBandeja.chip) arrasteBandeja.chip.classList.remove("arrastando");

    arrasteBandeja = null;
    precisaDesenhar = true;
  }

  function soltarNaOnda(i, tempo) {
    const legenda = legendas[i];
    if (!legenda || !Number.isFinite(tempo)) return;

    colocar(legenda, tempo);
    indiceSelecionado = i;
    aposEdicao();
  }

  function ligarBandeja() {
    const itens = el("ondasBandejaItens");

    itens.addEventListener("pointerdown", evento => {
      const chip = evento.target.closest(".ondas-chip");
      if (!chip || arrasteBandeja) return;

      arrasteBandeja = {
        id: evento.pointerId,
        chip,
        i: Number(chip.dataset.i),
        x0: evento.clientX,
        y0: evento.clientY,
        clientX: evento.clientX,
        clientY: evento.clientY,
        ativo: false,
        fantasma: null,
        tempo: null,
        relativo: null
      };

      try { chip.setPointerCapture(evento.pointerId); } catch (erro) { /* ignora */ }
    });

    itens.addEventListener("pointermove", evento => {
      const a = arrasteBandeja;
      if (!a || a.id !== evento.pointerId) return;

      a.clientX = evento.clientX;
      a.clientY = evento.clientY;

      if (!a.ativo && Math.hypot(evento.clientX - a.x0, evento.clientY - a.y0) > 6) {
        a.ativo = true;
        a.chip.classList.add("arrastando");

        const fantasma = document.createElement("div");
        fantasma.className = "ondas-fantasma";
        fantasma.textContent = a.chip.querySelector(".texto").textContent;
        document.body.appendChild(fantasma);
        a.fantasma = fantasma;

        if (indiceSelecionado !== a.i) {
          indiceSelecionado = a.i;
          destacarSelecionadaNaBandeja();
        }
      }

      if (!a.ativo) return;

      a.fantasma.style.left = evento.clientX + "px";
      a.fantasma.style.top = evento.clientY + "px";

      const posicao = posicaoNaOnda(evento.clientX, evento.clientY);
      a.tempo = posicao ? posicao.tempo : null;
      a.relativo = posicao ? posicao.relativo : null;
      precisaDesenhar = true;
    });

    const soltar = evento => {
      const a = arrasteBandeja;
      if (!a || a.id !== evento.pointerId) return;

      const { i, ativo } = a;
      const posicao = ativo ? posicaoNaOnda(evento.clientX, evento.clientY) : null;

      encerrarArrasteBandeja();

      if (ativo) {
        if (posicao && evento.type !== "pointercancel") soltarNaOnda(i, posicao.tempo);
        else atualizarBandeja();
        return;
      }

      /* Toque simples: só seleciona. */
      if (evento.type !== "pointercancel") selecionar(i);
    };

    itens.addEventListener("pointerup", soltar);
    itens.addEventListener("pointercancel", soltar);
  }

  /* ---------- Reprodução e atualização ---------- */

  function aposEdicao() {
    renderizar();
    atualizarPainel();
    precisaDesenhar = true;
  }

  async function alternarPlay() {
    if (!audio.src) {
      aviso("Importe o áudio primeiro.");
      return;
    }

    if (audio.paused) {
      tocarLinhaFim = null;

      try {
        if (typeof prepararAudioContext === "function") prepararAudioContext();
        await audio.play();
      } catch (erro) {
        aviso("Não foi possível tocar o áudio.");
      }
    } else {
      audio.pause();
    }
  }

  async function tocarLinhaSelecionada() {
    const legenda = legendas[indiceSelecionado];
    if (!naOnda(legenda) || !audio.src) return;

    audio.currentTime = Math.max(0, legenda.inicio - 1);
    tocarLinhaFim = legenda.fim + 0.3;

    try {
      if (typeof prepararAudioContext === "function") prepararAudioContext();
      await audio.play();
    } catch (erro) {
      tocarLinhaFim = null;
      aviso("Não foi possível tocar o áudio.");
    }
  }

  /* ---------- Toque na onda ---------- */

  function acharAlca(x, y, largura) {
    const tipo = y < ALTURA / 2 ? "inicio" : "fim";
    let melhor = null;
    let distancia = RAIO_TOQUE + 1;

    legendas.forEach((legenda, i) => {
      if (!naOnda(legenda)) return;

      const xe = xDeTempo(tipo === "inicio" ? legenda.inicio : legenda.fim, largura);
      const d = Math.abs(x - xe) - (i === indiceSelecionado ? 3 : 0);

      if (d < distancia) {
        distancia = d;
        melhor = { legenda, i, tipo };
      }
    });

    return melhor;
  }

  /* Legenda na onda sob um tempo (a desenhada por último tem prioridade). */
  function indiceNaOnda(t) {
    for (let i = legendas.length - 1; i >= 0; i--) {
      const l = legendas[i];
      if (naOnda(l) && t >= l.inicio && t < l.fim) return i;
    }
    return -1;
  }

  function ligarEventos() {
    const canvasOndas = el("ondasCanvas");

    el("fecharOndas").addEventListener("click", fechar);
    el("ondasModal").addEventListener("click", evento => {
      if (evento.target === el("ondasModal")) fechar();
    });

    el("ondasPlay").addEventListener("click", alternarPlay);
    el("ondasTocarLinha").addEventListener("click", tocarLinhaSelecionada);
    el("ondasAnterior").addEventListener("click", () => irParaLegenda(indiceSelecionado - 1));
    el("ondasProxima").addEventListener("click", () => irParaLegenda(indiceSelecionado + 1));

    el("ondasCriarLinhas").addEventListener("click", criarLinhas);
    el("ondasSepararTodas").addEventListener("click", () => separar(false));
    el("ondasSepararSel").addEventListener("click", () => separar(true));
    el("ondasSepararDesfazer").addEventListener("click", desfazerSepararPalavras);
    el("ondasTirar").addEventListener("click", tirarSelecionada);
    el("ondasTirarTodas").addEventListener("click", tirarTodas);

    el("ondasZoom").addEventListener("input", evento => {
      const centro = inicioVisivel + janela / 2;
      janela = 60 * Math.pow(0.05, Number(evento.target.value) / 100);
      inicioVisivel = limitar(centro - janela / 2, 0, maxInicioVisivel());
      atualizarSliders();
      precisaDesenhar = true;
    });

    el("ondasPos").addEventListener("input", evento => {
      inicioVisivel = (Number(evento.target.value) / 1000) * maxInicioVisivel();
      precisaDesenhar = true;
    });

    el("ondasModal").querySelectorAll("[data-ajuste]").forEach(botao => {
      botao.addEventListener("click", () => {
        const legenda = legendas[indiceSelecionado];
        if (!naOnda(legenda)) return;

        const passo = Number(el("ondasPasso").value) || 0.1;
        const delta = Number(botao.dataset.sinal) * passo;

        if (botao.dataset.ajuste === "inicio") moverInicio(legenda, legenda.inicio + delta);
        else moverFim(legenda, legenda.fim + delta);

        aposEdicao();
      });
    });

    /* "= agora" no início também coloca na onda uma legenda que ainda está na bandeja. */
    el("ondasInicioAgora").addEventListener("click", () => {
      const legenda = legendas[indiceSelecionado];
      if (!legenda) return;

      if (naOnda(legenda)) moverInicio(legenda, audio.currentTime || 0);
      else colocar(legenda, audio.currentTime || 0);

      aposEdicao();
    });

    el("ondasFimAgora").addEventListener("click", () => {
      const legenda = legendas[indiceSelecionado];
      if (!naOnda(legenda)) return;

      moverFim(legenda, audio.currentTime || 0);
      aposEdicao();
    });

    ligarBandeja();

    canvasOndas.addEventListener("pointerdown", evento => {
      const retangulo = canvasOndas.getBoundingClientRect();
      const x = evento.clientX - retangulo.left;
      const y = evento.clientY - retangulo.top;
      const alca = acharAlca(x, y, retangulo.width);

      let bloco = null;

      if (!alca && y >= Y_FAIXA && y <= Y_FAIXA + ALTURA_FAIXA) {
        const tToque = tempoDeX(x, retangulo.width);
        const iBloco = indiceNaOnda(tToque);

        if (iBloco >= 0) {
          bloco = {
            legenda: legendas[iBloco],
            i: iBloco,
            t0: tToque,
            inicio0: legendas[iBloco].inicio,
            fim0: legendas[iBloco].fim
          };
        }
      }

      canvasOndas.setPointerCapture(evento.pointerId);

      arraste = {
        id: evento.pointerId,
        x0: x,
        y0: y,
        moveu: false,
        bloco,
        alca,
        inicioVisivel0: inicioVisivel
      };

      const alvo = alca ? alca.i : (bloco ? bloco.i : -1);

      if (alvo >= 0 && alvo !== indiceSelecionado) {
        indiceSelecionado = alvo;
        atualizarPainel();
      }

      precisaDesenhar = true;
    });

    canvasOndas.addEventListener("pointermove", evento => {
      if (!arraste || arraste.id !== evento.pointerId) return;

      const retangulo = canvasOndas.getBoundingClientRect();
      const x = evento.clientX - retangulo.left;
      const y = evento.clientY - retangulo.top;

      if (!arraste.moveu && Math.hypot(x - arraste.x0, y - arraste.y0) > 4) {
        arraste.moveu = true;
      }

      if (!arraste.moveu) return;

      if (arraste.bloco) {
        moverBloco(arraste.bloco, tempoDeX(x, retangulo.width) - arraste.bloco.t0);
        atualizarPainel();
      } else if (arraste.alca) {
        const { legenda, tipo } = arraste.alca;
        const t = Math.max(0, tempoDeX(x, retangulo.width));

        if (tipo === "inicio") moverInicio(legenda, t);
        else moverFim(legenda, t);

        atualizarPainel();
      } else {
        inicioVisivel = limitar(
          arraste.inicioVisivel0 - ((x - arraste.x0) / retangulo.width) * janela,
          0,
          maxInicioVisivel()
        );
        atualizarSliders();
      }

      precisaDesenhar = true;
    });

    const terminar = evento => {
      if (!arraste || arraste.id !== evento.pointerId) return;

      const retangulo = canvasOndas.getBoundingClientRect();
      const x = evento.clientX - retangulo.left;
      const y = evento.clientY - retangulo.top;
      const atual = arraste;
      arraste = null;

      if (atual.moveu) {
        if (atual.alca || atual.bloco) aposEdicao();
        precisaDesenhar = true;
        return;
      }

      if (atual.alca) {
        selecionar(atual.alca.i);
        return;
      }

      const t = tempoDeX(x, retangulo.width);

      if (y >= Y_FAIXA && y <= Y_FAIXA + ALTURA_FAIXA) {
        const indice = indiceNaOnda(t);
        if (indice >= 0) selecionar(indice);
      } else if (audio.src) {
        audio.currentTime = limitar(t, 0, duracaoTotal() || t);
      }

      precisaDesenhar = true;
    };

    canvasOndas.addEventListener("pointerup", terminar);
    canvasOndas.addEventListener("pointercancel", terminar);

    canvasOndas.addEventListener("wheel", evento => {
      evento.preventDefault();

      const retangulo = canvasOndas.getBoundingClientRect();
      const x = evento.clientX - retangulo.left;
      const tCursor = tempoDeX(x, retangulo.width);
      const fator = evento.deltaY > 0 ? 1.2 : 1 / 1.2;

      janela = limitar(janela * fator, 3, 60);
      inicioVisivel = limitar(tCursor - (x / retangulo.width) * janela, 0, maxInicioVisivel());
      atualizarSliders();
      precisaDesenhar = true;
    }, { passive: false });

    window.addEventListener("resize", () => { if (aberto) precisaDesenhar = true; });

    document.addEventListener("keydown", evento => {
      if (aberto && evento.key === "Escape") fechar();
    });
  }

  function ciclo() {
    if (!aberto) return;

    const t = audio.currentTime || 0;
    const agora = performance.now();
    const dt = Math.min(0.05, Math.max(0, (agora - ultimoQuadro) / 1000));
    ultimoQuadro = agora;

    /* Ao arrastar um item da bandeja perto das bordas da onda, a onda rola. */
    if (arrasteBandeja && arrasteBandeja.ativo && arrasteBandeja.relativo !== null) {
      const f = arrasteBandeja.relativo;
      const empurrao = f < 0.08 ? -(0.08 - f) / 0.08 : (f > 0.92 ? (f - 0.92) / 0.08 : 0);

      if (empurrao) {
        inicioVisivel = limitar(inicioVisivel + empurrao * janela * 0.9 * dt, 0, maxInicioVisivel());
        const posicao = posicaoNaOnda(arrasteBandeja.clientX, arrasteBandeja.clientY);
        arrasteBandeja.tempo = posicao ? posicao.tempo : null;
        atualizarSliders();
        precisaDesenhar = true;
      }
    }

    if (indiceSelecionado !== indicePainel) {
      atualizarPainel();
      precisaDesenhar = true;
    }

    if (!audio.paused) {
      if (!arraste && (t > inicioVisivel + janela * 0.85 || t < inicioVisivel)) {
        inicioVisivel = limitar(t - janela * 0.15, 0, maxInicioVisivel());
        atualizarSliders();
      }

      precisaDesenhar = true;
    }

    if (tocarLinhaFim !== null && t >= tocarLinhaFim) {
      audio.pause();
      tocarLinhaFim = null;
    }

    if (t !== ultimoTempo || audio.paused !== (el("ondasPlay").textContent.startsWith("▶"))) {
      ultimoTempo = t;
      atualizarRotulos(t);
      precisaDesenhar = true;
    }

    if (precisaDesenhar) {
      precisaDesenhar = false;
      desenharOnda();
    }

    rafOndas = requestAnimationFrame(ciclo);
  }

  async function abrir() {
    if (!audio.src) {
      mensagem("Importe o áudio antes de abrir as Ondas.");
      return;
    }

    montar();
    focoAnterior = document.activeElement;

    if (legendas.length && !legendas[indiceSelecionado]) {
      const primeiraNaBandeja = legendas.findIndex(l => !naOnda(l));
      indiceSelecionado = primeiraNaBandeja >= 0 ? primeiraNaBandeja : 0;
    }

    el("ondasLetraBox").open = !legendas.length;
    el("ondasModal").classList.add("aberto");
    document.body.classList.add("ondas-aberto");
    aberto = true;

    const referencia = legendas[indiceSelecionado];
    inicioVisivel = limitar(
      (naOnda(referencia) ? referencia.inicio : audio.currentTime || 0) - janela * 0.25,
      0,
      maxInicioVisivel()
    );

    atualizarSliders();
    atualizarPainel();
    atualizarRotulos(audio.currentTime || 0);
    precisaDesenhar = true;

    el("fecharOndas").focus();
    cancelAnimationFrame(rafOndas);
    rafOndas = requestAnimationFrame(ciclo);

    await carregarPicos();
    inicioVisivel = limitar(inicioVisivel, 0, maxInicioVisivel());
    atualizarSliders();
  }

  function fechar() {
    aberto = false;
    encerrarArrasteBandeja();
    cancelAnimationFrame(rafOndas);
    tocarLinhaFim = null;
    arraste = null;

    if (!audio.paused) audio.pause();

    const modal = el("ondasModal");
    if (modal) modal.classList.remove("aberto");
    document.body.classList.remove("ondas-aberto");

    renderizar();

    if (focoAnterior && typeof focoAnterior.focus === "function") focoAnterior.focus();
  }

  const botaoAbrir = el("abrirOndas");
  if (botaoAbrir) botaoAbrir.addEventListener("click", abrir);
})();
