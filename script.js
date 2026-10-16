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
  limparHistoricoCortes();

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
   CRIAÇÃO E EDIÇÃO DE LEGENDAS
========================================================= */

function extrairTempoDeLinha(linha) {
  const texto = String(linha || "").trim();
  if (!texto) return null;

  const match = texto.match(
    /^(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?)(?:\s*[:\-–]\s*|\s+)(.*)$/
  );

  if (!match) return null;

  const tempoTexto = match[1];
  const textoRestante = (match[2] || "").trim();

  const tempoEmSegundos = campoParaTempo(tempoTexto);
  if (!Number.isFinite(tempoEmSegundos) || tempoEmSegundos < 0) return null;

  return {
    inicio: tempoEmSegundos,
    texto: textoRestante
  };
}

function criarLegendasDoTexto(texto) {
  const linhas = texto
    .split(/\r?\n/)
    .map(linha => linha.trim())
    .filter(Boolean);

  if (!linhas.length) return [];

  const linhasComTempo = linhas
    .map(linha => extrairTempoDeLinha(linha))
    .filter(Boolean);

  if (linhasComTempo.length === linhas.length) {
    const novasLegendas = [];

    for (let i = 0; i < linhasComTempo.length; i++) {
      const atual = linhasComTempo[i];
      const proximo = linhasComTempo[i + 1];

      const fim = proximo
        ? Math.max(atual.inicio + 0.5, proximo.inicio)
        : Math.max(atual.inicio + 0.5, atual.inicio + 3);

      novasLegendas.push({
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + i),
        texto: atual.texto,
        inicio: atual.inicio,
        fim
      });
    }

    return novasLegendas;
  }

  const duracao = obterDuracao();
  const intervalo = duracao > 0 ? duracao / linhas.length : 3;

  return linhas.map((textoLinha, indice) => ({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + indice),
    texto: textoLinha,
    inicio: indice * intervalo,
    fim: (indice + 1) * intervalo
  }));
}

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

  legendas = criarLegendasDoTexto(texto);

  if (!legendas.length) {
    mensagem("Não foi possível criar legendas a partir do texto informado.");
    return;
  }

  indiceSelecionado = 0;
  atualizarSeletorLegendas();
  desenharLista();
  renderizar();

  mensagem(
    "Legendas criadas com sincronização por tempo."
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
      String(indice + 1).padStart(2, "0") + " — " + legenda.texto.slice(0, 55);
    seletor.appendChild(opcao);
  });

  seletor.value = String(indiceSelecionado);
}

$("linhaSelecionada").addEventListener("change", () => {
  indiceSelecionado = Number($("linhaSelecionada").value);

  if (!Number.isInteger(indiceSelecionado)) indiceSelecionado = -1;

  desenharLista();
  renderizar();
});

$("marcarInicio").addEventListener("click", () => {
  const legenda = legendaSelecionada();

  if (!legenda) {
    mensagem("Selecione uma legenda primeiro.");
    return;
  }

  const antigoInicio = Number(legenda.inicio) || 0;
  const novoInicio = Math.max(0, audio.currentTime || 0);
  const delta = novoInicio - antigoInicio;

  legenda.inicio = novoInicio;

  if (legenda.fim <= legenda.inicio) {
    legenda.fim = legenda.inicio + 1;
  }

  if (delta !== 0) {
    rippleAdjust(indiceSelecionado, delta);
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

  const antigoFim = Number(legenda.fim) || 0;
  const tempoAtual = Math.max(0, audio.currentTime || 0);

  if (tempoAtual <= legenda.inicio) {
    mensagem("O fim deve acontecer depois do início.");
    return;
  }

  const delta = tempoAtual - antigoFim;

  legenda.fim = tempoAtual;

  if (delta !== 0) {
    rippleAdjust(indiceSelecionado, delta);
  }

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
      legenda.fim = Math.max(legenda.inicio + 0.5, legendas[i + 1].inicio);
    }
  }
}

function selecionarLegenda(indice) {
  indiceSelecionado = indice;
  $("linhaSelecionada").value = String(indice);
  desenharLista();
  renderizar();
}

/* ---------------------------------------------------------
   CASCATA NA EDIÇÃO MANUAL
   Controlada pela caixa "deslocar também as legendas seguintes".
--------------------------------------------------------- */

function cascataAtiva() {
  const campo = $("recalcularSeguintes");
  return !campo || campo.checked;
}

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
      inicio: entrada.inicio,
      fim
    });
  });

  return { legendas: resultadoFinal, ignoradas };
}

$("criarLinhasComTempos").addEventListener("click", () => {
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

  atualizarSeletorLegendas();
  desenharLista();
  renderizar();

  mensagem(
    novas.length + (novas.length === 1 ? " legenda criada" : " legendas criadas") +
    " com os tempos colados." +
    (ignoradas ? " " + ignoradas + (ignoradas === 1 ? " linha sem tempo foi ignorada." : " linhas sem tempo foram ignoradas.") : "")
  );
});

/* ======= Ajustes em cascata (ripple) e auto-sincronização aproximada ======= */

function rippleAdjust(startIndex, delta) {
  if (!delta || !legendas.length) return;
  for (let i = startIndex + 1; i < legendas.length; i++) {
    legendas[i].inicio = Math.max(0, (Number(legendas[i].inicio) || 0) + delta);
    legendas[i].fim = Math.max(legendas[i].inicio + 0.01, (Number(legendas[i].fim) || 0) + delta);
  }
}

let _audioBufferCache = null;
let _audioBufferSrc = null;

async function carregarAudioBuffer() {
  if (!audio.src) throw new Error("Importe o áudio antes de tentar auto-sincronizar.");
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

function envelopeFromBuffer(buffer, hopMs = 10) {
  const sampleRate = buffer.sampleRate;
  const hop = Math.max(1, Math.floor(sampleRate * hopMs / 1000));
  const channelData = [];

  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channelData.push(buffer.getChannelData(c));
  }

  const length = buffer.length;
  const rms = [];
  const times = [];

  for (let i = 0; i < length; i += hop) {
    let sum = 0;
    const end = Math.min(length, i + hop);

    for (let c = 0; c < channelData.length; c++) {
      const chan = channelData[c];
      for (let j = i; j < end; j++) {
        const v = chan[j];
        sum += v * v;
      }
    }

    const n = (end - i) * channelData.length;
    const val = n > 0 ? Math.sqrt(sum / n) : 0;
    rms.push(val);
    times.push(i / sampleRate);
  }

  return { times, rms };
}

function stats(values) {
  const arr = values.slice().sort((a,b)=>a-b);
  const mid = Math.floor(arr.length / 2);
  const median = arr.length ? (arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2) : 0;
  const mean = arr.reduce((s,v) => s + v, 0) / Math.max(1, arr.length);
  const variance = arr.reduce((s,v) => s + (v - mean) * (v - mean), 0) / Math.max(1, arr.length);
  return { median, mean, std: Math.sqrt(variance) };
}

function detectPeaksAdaptive(rms, times, options = {}) {
  const { minDistance = 0.06, thresholdMultiplier = 1.0, absoluteMin = 0.008 } = options;
  if (!rms || !rms.length) return [];

  const s = stats(rms);
  const dynamicThreshold = Math.max(absoluteMin, s.median + s.std * thresholdMultiplier);

  const raw = [];
  for (let i = 1; i < rms.length - 1; i++) {
    if (rms[i] > rms[i - 1] && rms[i] >= rms[i + 1] && rms[i] >= dynamicThreshold) {
      raw.push({ time: times[i], value: rms[i] });
    }
  }

  const filtered = [];
  for (const p of raw) {
    if (!filtered.length) { filtered.push(p); continue; }
    const last = filtered[filtered.length - 1];
    if (p.time - last.time < minDistance) {
      if (p.value > last.value) filtered[filtered.length - 1] = p;
    } else {
      filtered.push(p);
    }
  }

  return filtered;
}

async function autoAlignAllImproved({
  windowSec = 0.8,
  preOffset = 0.05,
  maxShift = 1.5,
  thresholdMultiplier = 0.9
} = {}) {
  try {
    mensagem("Analisando áudio para auto-sincronização... Aguarde.");
    const buffer = await carregarAudioBuffer();
    const env = envelopeFromBuffer(buffer, 8);
    const peaks = detectPeaksAdaptive(env.rms, env.times, {
      minDistance: 0.04,
      thresholdMultiplier,
      absoluteMin: 0.008
    });

    if (!peaks.length) {
      mensagem("Não foram encontrados picos claros no áudio. Tente diminuir threshold ou aumentar a janela.");
      return;
    }

    const totalDuration = buffer.duration || obterDuracao() || (legendas.length * 2);

    for (let i = 0; i < legendas.length; i++) {
      const L = legendas[i];
      const dur = Math.max(0.1, (L.fim - L.inicio) || (totalDuration / Math.max(1, legendas.length)));
      const expected = (Number.isFinite(L.inicio) && L.inicio > 0)
        ? L.inicio
        : (i / Math.max(1, legendas.length)) * totalDuration;

      const candidatos = peaks.filter(p => Math.abs(p.time - expected) <= windowSec);

      let novoInicio = null;

      if (candidatos.length) {
        const maxVal = Math.max(...peaks.map(p => p.value), 1);
        candidatos.sort((a, b) => {
          const scA = Math.abs(a.time - expected) - (a.value / maxVal) * 0.3;
          const scB = Math.abs(b.time - expected) - (b.value / maxVal) * 0.3;
          return scA - scB;
        });
        novoInicio = Math.max(0, candidatos[0].time - preOffset);
      } else {
        const glob = peaks.reduce((best, p) => {
          const d = Math.abs(p.time - expected);
          if (!best || d < best.d) return { p, d };
          return best;
        }, null);

        if (glob && glob.d <= windowSec * 2) {
          novoInicio = Math.max(0, glob.p.time - preOffset);
        }
      }

      if (novoInicio !== null) {
        const shift = novoInicio - L.inicio;
        if (Math.abs(shift) <= maxShift) {
          L.inicio = novoInicio;
          L.fim = Math.max(L.inicio + 0.05, L.inicio + dur);
        }
      }
    }

    for (let i = 1; i < legendas.length; i++) {
      const prev = legendas[i - 1];
      const cur = legendas[i];
      if (cur.inicio < prev.fim + 0.01) {
        const needed = prev.fim + 0.01 - cur.inicio;
        const push = Math.min(needed, maxShift);
        cur.inicio += push;
        cur.fim += push;
      }
    }

    mensagem("Auto-sincronização (melhorada) concluída. Revise e ajuste manualmente se necessário.");
    atualizarSeletorLegendas();
    desenharLista();
    renderizar();
  } catch (erro) {
    console.error("autoAlignAllImproved erro:", erro);
    mensagem("Auto-sincronização falhou: " + (erro && erro.message ? erro.message : "erro desconhecido"));
  }
}

(function criarBotaoAutoSync() {
  const toolbar = document.querySelector(".sync-toolbar");
  if (!toolbar) return;
  if (document.getElementById("autoSyncBtn")) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "autoSyncBtn";
  btn.className = "secondary-button";
  btn.textContent = "Auto-sincronizar (aprox.)";

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      await autoAlignAllImproved();
    } finally {
      btn.disabled = false;
    }
  });

  toolbar.appendChild(btn);
})();

/* =========================================================
   DESENHO DA LISTA DE LEGENDAS
========================================================= */

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

    linha.className = "caption-row" +
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
      if (indiceSelecionado !== indice) selecionarLegenda(indice);
    });

    campoInicio.addEventListener("change", () => {
      const oldInicio = legenda.inicio;
      const novo = Math.max(0, campoParaTempo(campoInicio.value));
      const delta = novo - oldInicio;

      legenda.inicio = novo;

      if (cascataAtiva()) {
        /* A própria legenda mantém a duração e as seguintes acompanham. */
        legenda.fim = Math.max(legenda.inicio + 0.5, legenda.fim + delta);
        if (delta !== 0) rippleAdjust(indice, delta);
      } else if (legenda.fim <= legenda.inicio) {
        legenda.fim = legenda.inicio + 0.5;
      }

      /* Redesenha a lista inteira para atualizar também as linhas seguintes. */
      desenharLista();
      renderizar();
    });

    campoFim.addEventListener("change", () => {
      const oldFim = legenda.fim;
      let novoFim = campoParaTempo(campoFim.value);

      if (novoFim <= legenda.inicio) novoFim = legenda.inicio + 0.5;
      const delta = novoFim - oldFim;

      legenda.fim = novoFim;

      if (cascataAtiva() && delta !== 0) {
        rippleAdjust(indice, delta);
      }

      desenharLista();
      renderizar();
    });

    texto.addEventListener("input", () => {
      legenda.texto = texto.value;
      atualizarSeletorLegendas();
      renderizar();
    });

    irInicio.addEventListener("click", event => {
      event.stopPropagation();
      if (audio.src) audio.currentTime = legenda.inicio;
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
        indiceSelecionado = Math.min(indiceSelecionado, legendas.length - 1);
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

  let valor = numeroOu(origem.value, 50);
  valor = limitar(Math.round(valor), 0, 100);

  if (origem === barra) numero.value = valor;
  else barra.value = valor;

  rotulo.textContent = valor + "%" + (valor === 50 ? " (normal)" : "");
  renderizar();
}

$("velocidadeAnimTexto").addEventListener("input", e => sincronizarVelocidadeAnimacao(e.target));
$("velocidadeAnimTextoNum").addEventListener("input", e => {
  if (e.target.value === "") return;
  sincronizarVelocidadeAnimacao(e.target);
});
$("velocidadeAnimTextoNum").addEventListener("blur", e => {
  if (e.target.value === "") e.target.value = $("velocidadeAnimTexto").value;
});

function removerAnimacaoImportada() {
  animacaoTextoImportada = null;

  const seletor = $("animacaoTexto");
  const opcao = seletor.querySelector('option[value="importada"]');
  if (opcao) opcao.remove();
  if (seletor.value === "importada" || !seletor.value) seletor.value = "none";

  $("estadoAnimacaoTexto").textContent =
    "Nenhuma animação importada. Baixe o modelo, edite e importe de volta.";
}

$("arquivoAnimacaoTexto").addEventListener("change", async event => {
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

    $("estadoAnimacaoTexto").textContent =
      "Animação \"" + preset.nome + "\" importada e selecionada.";
    mensagem("Animação do texto importada: " + preset.nome + ".");
    renderizar();
  } catch (erro) {
    $("estadoAnimacaoTexto").textContent =
      "Não foi possível importar: " + (erro && erro.message ? erro.message : "arquivo inválido");
    mensagem("Não foi possível importar a animação do texto.");
  } finally {
    event.target.value = "";
  }
});

$("baixarModeloAnimacaoTexto").addEventListener("click", () => {
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

$("removerAnimacaoTexto").addEventListener("click", () => {
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
    const pesos = palavrasTodas.map(p => Math.max(2, p.length) + 1);
    const total = pesos.reduce((soma, peso) => soma + peso, 0);
    const alvo = progresso * total;
    let acumulado = 0;

    for (let i = 0; i < pesos.length; i++) {
      const fimSlot = acumulado + pesos[i];

      if (alvo < fimSlot || i === pesos.length - 1) {
        indicePalavra = i;
        duracaoSlot = (pesos[i] / total) * duracaoLegenda;
        tempoNaPalavra = ((alvo - acumulado) / total) * duracaoLegenda;
        break;
      }

      acumulado = fimSlot;
    }
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
  $(id).addEventListener("input", renderizar);
  $(id).addEventListener("change", renderizar);
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
    if (!trimEnd) trimEnd = duration;
    if (trimEnd > duration) trimEnd = duration;
    renderHandles();
    atualizarLabels();
  }

  audio.addEventListener("loadedmetadata", atualizarDuracao);
  audio.addEventListener("durationchange", atualizarDuracao);

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
    getStart: () => trimStart || 0,
    getEnd: () => (trimEnd == null ? duration : trimEnd),
    setStartEnd: (s, e) => {
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
   CORTAR TRECHO — música e letra juntas
   O áudio é recortado de verdade (vira um WAV novo) e as
   legendas são ajustadas ao mesmo tempo.
========================================================= */

const historicoCortes = [];
let corteOuvirFim = null;

function audioParaWav(canais, taxa) {
  const quantidadeCanais = canais.length;
  const amostras = canais[0].length;
  const tamanhoDados = amostras * quantidadeCanais * 2;
  const buffer = new ArrayBuffer(44 + tamanhoDados);
  const v = new DataView(buffer);

  const texto = (posicao, str) => {
    for (let i = 0; i < str.length; i++) v.setUint8(posicao + i, str.charCodeAt(i));
  };

  texto(0, "RIFF");
  v.setUint32(4, 36 + tamanhoDados, true);
  texto(8, "WAVE");
  texto(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, quantidadeCanais, true);
  v.setUint32(24, taxa, true);
  v.setUint32(28, taxa * quantidadeCanais * 2, true);
  v.setUint16(32, quantidadeCanais * 2, true);
  v.setUint16(34, 16, true);
  texto(36, "data");
  v.setUint32(40, tamanhoDados, true);

  let posicao = 44;

  for (let i = 0; i < amostras; i++) {
    for (let c = 0; c < quantidadeCanais; c++) {
      const s = Math.max(-1, Math.min(1, canais[c][i]));
      v.setInt16(posicao, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      posicao += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function aplicarCorteNasLegendas(lista, a, b) {
  const d = b - a;
  const resultado = [];

  for (const legenda of lista) {
    if (legenda.fim <= a) {
      resultado.push(legenda);
      continue;
    }

    if (legenda.inicio >= b) {
      legenda.inicio -= d;
      legenda.fim -= d;
      resultado.push(legenda);
      continue;
    }

    const novoInicio = legenda.inicio < a ? legenda.inicio : a;
    const novoFim = legenda.fim > b ? legenda.fim - d : a;

    if (novoFim - novoInicio >= 0.2) {
      legenda.inicio = novoInicio;
      legenda.fim = novoFim;
      resultado.push(legenda);
    }
  }

  return resultado;
}

function lerTempoCorte(campo) {
  return campoParaTempo(String($(campo).value).replace(",", "."));
}

function informarCorte(texto) {
  const estado = $("estadoCorte");
  if (estado) estado.textContent = texto;
  mensagem(texto);
}

function atualizarBotaoDesfazerCorte() {
  $("desfazerCorte").disabled = historicoCortes.length === 0;
}

function limparHistoricoCortes() {
  while (historicoCortes.length) {
    const item = historicoCortes.pop();
    if (item.url && item.url !== audioURL) URL.revokeObjectURL(item.url);
  }
  atualizarBotaoDesfazerCorte();
  document.dispatchEvent(new Event("lyric:audio-alterado"));
}

function esperarMetadadosAudio() {
  return new Promise(resolver => {
    let resolvido = false;

    const terminar = () => {
      if (resolvido) return;
      resolvido = true;
      audio.removeEventListener("loadedmetadata", terminar);
      audio.removeEventListener("error", terminar);
      resolver();
    };

    audio.addEventListener("loadedmetadata", terminar);
    audio.addEventListener("error", terminar);
    setTimeout(terminar, 8000);
  });
}

async function trocarAudio(url) {
  audio.pause();
  audio.src = url;
  audio.load();
  await esperarMetadadosAudio();
  atualizarTempo();

  if (window._editorTrim) {
    window._editorTrim.setStartEnd(0, obterDuracao());
  }
}

async function cortarTrecho(inicio, fim) {
  if (exportando) {
    informarCorte("Aguarde a exportação terminar para cortar.");
    return;
  }

  if (!audio.src) {
    informarCorte("Importe um áudio antes de cortar.");
    return;
  }

  const duracao = obterDuracao();

  if (!duracao) {
    informarCorte("Aguarde a duração do áudio ser identificada.");
    return;
  }

  inicio = limitar(inicio, 0, duracao);
  fim = limitar(fim, 0, duracao);

  if (fim - inicio < 0.05) {
    informarCorte("O fim do corte precisa ser depois do início.");
    return;
  }

  audio.pause();
  corteOuvirFim = null;
  $("cortarTrecho").disabled = true;
  informarCorte("Cortando... aguarde.");

  try {
    const buffer = await carregarAudioBuffer();
    const taxa = buffer.sampleRate;
    const i0 = Math.min(buffer.length, Math.round(inicio * taxa));
    const i1 = Math.min(buffer.length, Math.round(fim * taxa));
    const novoTamanho = buffer.length - (i1 - i0);

    if (novoTamanho < taxa * 0.1) {
      informarCorte("Esse corte removeria quase todo o áudio.");
      return;
    }

    const canais = [];

    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const original = buffer.getChannelData(c);
      const novo = new Float32Array(novoTamanho);
      novo.set(original.subarray(0, i0), 0);
      novo.set(original.subarray(i1), i0);
      canais.push(novo);
    }

    const urlNovo = URL.createObjectURL(audioParaWav(canais, taxa));

    historicoCortes.push({
      url: audioURL,
      nome: $("nomeAudio").textContent,
      legendas: legendas,
      indice: indiceSelecionado,
      inicio,
      fim
    });

    if (historicoCortes.length > 10) {
      const antigo = historicoCortes.shift();
      if (antigo.url && antigo.url !== audioURL) URL.revokeObjectURL(antigo.url);
    }

    const quantidadeAntes = legendas.length;
    const copias = legendas.map(legenda => ({ ...legenda }));

    audioURL = urlNovo;
    await trocarAudio(urlNovo);

    legendas = aplicarCorteNasLegendas(copias, inicio, fim);
    indiceSelecionado = legendas.length
      ? Math.min(Math.max(0, indiceSelecionado), legendas.length - 1)
      : -1;

    const removidas = quantidadeAntes - legendas.length;

    audio.currentTime = Math.min(inicio, Math.max(0, obterDuracao() - 0.01));
    atualizarSeletorLegendas();
    desenharLista();
    atualizarBotaoDesfazerCorte();
    renderizar();

    document.dispatchEvent(new Event("lyric:audio-alterado"));

    informarCorte(
      "Trecho de " + formatarTempo(inicio) + " a " + formatarTempo(fim) + " cortado. " +
      "Nova duração: " + formatarTempo(obterDuracao()) + "." +
      (removidas ? " " + removidas + (removidas === 1 ? " legenda foi removida." : " legendas foram removidas.") : "")
    );
  } catch (erro) {
    console.error("Erro ao cortar:", erro);
    informarCorte("Não foi possível cortar este áudio: " + (erro && erro.message ? erro.message : "erro desconhecido"));
  } finally {
    $("cortarTrecho").disabled = false;
  }
}

async function desfazerUltimoCorte() {
  const item = historicoCortes.pop();

  if (!item) {
    informarCorte("Não há corte para desfazer.");
    return;
  }

  if (exportando) {
    historicoCortes.push(item);
    informarCorte("Aguarde a exportação terminar para desfazer.");
    return;
  }

  const urlAtual = audioURL;

  audioURL = item.url;
  await trocarAudio(item.url);

  if (urlAtual && urlAtual !== item.url) URL.revokeObjectURL(urlAtual);

  legendas = item.legendas;
  indiceSelecionado = item.indice;

  audio.currentTime = Math.min(item.inicio, Math.max(0, obterDuracao() - 0.01));
  atualizarSeletorLegendas();
  desenharLista();
  atualizarBotaoDesfazerCorte();
  renderizar();

  document.dispatchEvent(new Event("lyric:audio-alterado"));
  informarCorte("Corte desfeito. A música e a letra voltaram como estavam.");
}

$("corteInicioAgora").addEventListener("click", () => {
  $("corteInicio").value = tempoParaCampo(audio.currentTime || 0);
});

$("corteFimAgora").addEventListener("click", () => {
  $("corteFim").value = tempoParaCampo(audio.currentTime || 0);
});

$("corteUsarTrim").addEventListener("click", () => {
  const trim = window._editorTrim;

  if (!trim || !obterDuracao()) {
    informarCorte("Importe o áudio para usar as alças da prévia.");
    return;
  }

  $("corteInicio").value = tempoParaCampo(trim.getStart());
  $("corteFim").value = tempoParaCampo(trim.getEnd());
  informarCorte("Trecho das alças da prévia copiado para o corte.");
});

$("corteOuvir").addEventListener("click", async () => {
  if (!audio.src) {
    informarCorte("Importe um áudio primeiro.");
    return;
  }

  const inicio = lerTempoCorte("corteInicio");
  const fim = lerTempoCorte("corteFim");

  if (fim - inicio < 0.05) {
    informarCorte("O fim do corte precisa ser depois do início.");
    return;
  }

  prepararAudioContext();
  audio.currentTime = inicio;
  corteOuvirFim = fim;

  try {
    await audio.play();
  } catch (erro) {
    corteOuvirFim = null;
    informarCorte("Não foi possível tocar o trecho.");
  }
});

audio.addEventListener("timeupdate", () => {
  if (corteOuvirFim !== null && audio.currentTime >= corteOuvirFim) {
    corteOuvirFim = null;
    audio.pause();
  }
});

$("cortarTrecho").addEventListener("click", () => {
  cortarTrecho(lerTempoCorte("corteInicio"), lerTempoCorte("corteFim"));
});

$("desfazerCorte").addEventListener("click", desfazerUltimoCorte);

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

  const trimStart = window._editorTrim?.getStart?.() ?? 0;
  const trimEnd = window._editorTrim?.getEnd?.() ?? obterDuracao();

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
  const faixasAudio = audioDestination ? audioDestination.stream.getAudioTracks() : [];
  faixasAudio.forEach(faixa => streamVideo.addTrack(faixa));

  partesVideo = [];

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

    setTimeout(() => URL.revokeObjectURL(url), 60000);
    streamVideo.getTracks().forEach(track => track.stop());

    if (!audio.paused) audio.pause();
    if (videoFundo.src) videoFundo.pause();

    encerrarExportacao();
    mensagem(`Exportação concluída. Arquivo gerado: ${extensao.toUpperCase()}.`);
  };

  exportando = true;
  $("exportar").disabled = true;
  $("pararExportacao").disabled = false;

  audio.currentTime = trimStart;

  if (videoFundo.src) {
    try {
      videoFundo.currentTime = trimStart;
      await videoFundo.play();
    } catch (erro) {
      console.warn("O vídeo de fundo não iniciou automaticamente.", erro);
    }
  }

  renderizar();
  mediaRecorder.start(250);

  try {
    await audio.play();
    mensagem(`Exportando trecho: ${formatarTempo(trimStart)} → ${formatarTempo(trimEnd)}. Não feche a página.`);
  } catch (erro) {
    if (mediaRecorder.state === "recording") mediaRecorder.stop();
    mensagem("Não foi possível iniciar a reprodução do áudio para exportar.");
    return;
  }

  function acompanharExportacao() {
    if (!exportando) return;

    renderizar();

    if (audio.currentTime >= trimEnd) {
      if (mediaRecorder?.state === "recording") mediaRecorder.stop();
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
      { id: "sec-letra", titulo: "Letra", icone: "≡" },
      { id: "sec-legendas", titulo: "Sincronização das legendas", icone: "◷" },
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
   ONDAS: forma de onda, ajuste fino e âncoras
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
  const TOLERANCIA_COLADA = 0.05;

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
  let rafOndas = null;
  let tocarLinhaFim = null;
  let focoAnterior = null;
  let ultimoTempo = -1;

  const ancoras = new Set();
  const inicioEditado = new Set();
  const fimEditado = new Set();
  let base = new Map();
  let desfazerEsticamento = null;

  /* Modo "Letra solta": linhas ainda sem posição, prontas para arrastar. */
  const DURACAO_PADRAO = 3;
  const LIMITE_LIGAR = 2.5;
  let modo = "ondas";
  let bandeja = [];
  let armada = null;
  let guiaSolta = null;
  let arrasteChip = null;
  let contadorChips = 0;
  const pilhaSolta = [];

  const el = id => document.getElementById(id);

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

  /* ---------- Edição dos tempos ---------- */

  function coladasAtivas() {
    const campo = el("ondasColadas");
    return !campo || campo.checked;
  }

  function coladaAnterior(i) {
    const anterior = legendas[i - 1];
    return anterior && Math.abs(anterior.fim - legendas[i].inicio) < TOLERANCIA_COLADA
      ? anterior
      : null;
  }

  function coladaSeguinte(i) {
    const seguinte = legendas[i + 1];
    return seguinte && Math.abs(seguinte.inicio - legendas[i].fim) < TOLERANCIA_COLADA
      ? seguinte
      : null;
  }

  function moverInicio(legenda, novo, colada) {
    const i = legendas.indexOf(legenda);
    if (i < 0) return;

    const anterior = colada !== undefined
      ? colada
      : (coladasAtivas() ? coladaAnterior(i) : null);

    const minimo = anterior ? anterior.inicio + MIN_DURACAO : 0;
    const maximo = legenda.fim - MIN_DURACAO;
    if (minimo > maximo) return;

    const valor = Math.min(maximo, Math.max(minimo, novo));
    legenda.inicio = valor;

    if (anterior) {
      anterior.fim = valor;
      fimEditado.add(anterior);
    }

    ancoras.add(legenda);
    inicioEditado.add(legenda);
  }

  function moverFim(legenda, novo, colada) {
    const i = legendas.indexOf(legenda);
    if (i < 0) return;

    const seguinte = colada !== undefined
      ? colada
      : (coladasAtivas() ? coladaSeguinte(i) : null);

    const minimo = legenda.inicio + MIN_DURACAO;
    let maximo = seguinte ? seguinte.fim - MIN_DURACAO : duracaoTotal();
    if (!(maximo > 0)) maximo = Infinity;
    if (minimo > maximo) return;

    const valor = Math.min(maximo, Math.max(minimo, novo));
    legenda.fim = valor;

    if (seguinte) {
      seguinte.inicio = valor;
      inicioEditado.add(seguinte);
    }

    fimEditado.add(legenda);
  }

  /* ---------- Esticamento entre âncoras ---------- */

  function calcularEsticamento(lista, conjuntoAncoras, inicios, fins, mapaBase) {
    const pontos = [];

    lista.forEach(legenda => {
      if (!conjuntoAncoras.has(legenda)) return;
      const original = mapaBase.get(legenda) || legenda;
      pontos.push({ orig: original.inicio, novo: legenda.inicio });
    });

    if (!pontos.length) {
      return { erro: "Marque ao menos uma âncora: ajuste uma linha ou toque em Fixar âncora." };
    }

    pontos.sort((a, b) => a.orig - b.orig);

    for (let k = 1; k < pontos.length; k++) {
      if (pontos[k].orig - pontos[k - 1].orig < 0.001) {
        return { erro: "Duas âncoras começavam no mesmo tempo. Solte uma delas." };
      }
      if (pontos[k].novo <= pontos[k - 1].novo) {
        return { erro: "As âncoras precisam manter a mesma ordem da música. Revise os tempos." };
      }
    }

    const ultimo = pontos[pontos.length - 1];

    const mapear = t => {
      if (t <= pontos[0].orig) return t + (pontos[0].novo - pontos[0].orig);
      if (t >= ultimo.orig) return t + (ultimo.novo - ultimo.orig);

      for (let k = 0; k < pontos.length - 1; k++) {
        const a = pontos[k];
        const b = pontos[k + 1];

        if (t >= a.orig && t <= b.orig) {
          const razao = (t - a.orig) / (b.orig - a.orig);
          return a.novo + razao * (b.novo - a.novo);
        }
      }

      return t;
    };

    const novos = new Map();

    /* Início e fim editados à mão são preservados; o resto é redistribuído. */
    lista.forEach(legenda => {
      const original = mapaBase.get(legenda) || legenda;

      const inicio = conjuntoAncoras.has(legenda) || inicios.has(legenda)
        ? legenda.inicio
        : Math.max(0, mapear(original.inicio));

      let fim = fins.has(legenda) ? legenda.fim : mapear(original.fim);
      fim = Math.max(inicio + MIN_DURACAO, fim);

      novos.set(legenda, { inicio, fim });
    });

    return { novos, quantidadeAncoras: pontos.length };
  }

  function limparReferencias() {
    const existentes = new Set(legendas);
    [ancoras, inicioEditado, fimEditado].forEach(conjunto => {
      Array.from(conjunto).forEach(l => { if (!existentes.has(l)) conjunto.delete(l); });
    });
  }

  function capturarBase() {
    const novaBase = new Map();

    legendas.forEach(legenda => {
      if (ancoras.has(legenda) && base.has(legenda)) {
        novaBase.set(legenda, base.get(legenda));
      } else {
        novaBase.set(legenda, { inicio: legenda.inicio, fim: legenda.fim });
      }
    });

    base = novaBase;
  }

  function esticarRestante() {
    limparReferencias();

    const resultado = calcularEsticamento(legendas, ancoras, inicioEditado, fimEditado, base);

    if (resultado.erro) {
      aviso(resultado.erro);
      return;
    }

    desfazerEsticamento = {
      tempos: legendas.map(l => ({ legenda: l, inicio: l.inicio, fim: l.fim })),
      ancoras: new Set(ancoras),
      inicios: new Set(inicioEditado),
      fins: new Set(fimEditado),
      base: new Map(base)
    };

    resultado.novos.forEach((valor, legenda) => {
      legenda.inicio = valor.inicio;
      legenda.fim = valor.fim;
    });

    ancoras.clear();
    inicioEditado.clear();
    fimEditado.clear();
    base = new Map();
    capturarBase();

    desenharLista();
    renderizar();
    atualizarPainel();
    precisaDesenhar = true;

    aviso(
      resultado.novos.size + " legendas ajustadas a partir de " +
      resultado.quantidadeAncoras + (resultado.quantidadeAncoras === 1 ? " âncora." : " âncoras.")
    );
  }

  function desfazer() {
    if (!desfazerEsticamento) return;

    desfazerEsticamento.tempos.forEach(item => {
      item.legenda.inicio = item.inicio;
      item.legenda.fim = item.fim;
    });

    ancoras.clear();
    inicioEditado.clear();
    fimEditado.clear();
    desfazerEsticamento.ancoras.forEach(l => ancoras.add(l));
    desfazerEsticamento.inicios.forEach(l => inicioEditado.add(l));
    desfazerEsticamento.fins.forEach(l => fimEditado.add(l));
    base = desfazerEsticamento.base;
    desfazerEsticamento = null;

    desenharLista();
    renderizar();
    atualizarPainel();
    precisaDesenhar = true;
    aviso("Esticamento desfeito.");
  }

  function limparAncoras() {
    ancoras.clear();
    inicioEditado.clear();
    fimEditado.clear();
    capturarBase();
    atualizarPainel();
    precisaDesenhar = true;
    aviso("Âncoras limpas. Os tempos atuais viraram o novo ponto de partida.");
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
      aviso("Não foi possível ler a forma de onda deste áudio. Os ajustes por botões continuam funcionando.");
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
    const selecionada = legendas[indiceSelecionado] || null;

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

    /* Legendas */
    legendas.forEach((legenda, i) => {
      if (legenda.fim < inicioVisivel || legenda.inicio > fimVisivel) return;

      const x1 = xDeTempo(legenda.inicio, largura);
      const x2 = xDeTempo(legenda.fim, largura);
      const sel = i === indiceSelecionado;

      c.fillStyle = sel ? "rgba(114,240,176,0.28)" : "rgba(110,160,230,0.20)";
      c.fillRect(x1, Y_FAIXA, Math.max(1, x2 - x1), ALTURA_FAIXA);
      c.strokeStyle = sel ? "#72f0b0" : "rgba(150,190,240,0.5)";
      c.lineWidth = 1;
      c.strokeRect(x1 + 0.5, Y_FAIXA + 0.5, Math.max(1, x2 - x1) - 1, ALTURA_FAIXA - 1);

      c.save();
      c.beginPath();
      c.rect(x1, Y_FAIXA, Math.max(1, x2 - x1), ALTURA_FAIXA);
      c.clip();
      c.fillStyle = "#edf3f8";
      c.font = "11px system-ui, sans-serif";
      c.textAlign = "left";
      c.fillText((i + 1) + ". " + String(legenda.texto || "").replace(/\s+/g, " "), x1 + 9, Y_FAIXA + ALTURA_FAIXA / 2);
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

      if (ancoras.has(legenda)) {
        c.strokeStyle = "#ffd84a";
        c.lineWidth = 2;
        c.beginPath();
        c.arc(x1, Y_FAIXA + ALTURA_FAIXA / 2, raio + 3, 0, Math.PI * 2);
        c.stroke();
      }

      c.fillStyle = "#ffb454";
      c.beginPath();
      c.arc(x2, ALTURA - 16, raio, 0, Math.PI * 2);
      c.fill();
    });

    /* Marcação durante o arraste */
    if (arraste && arraste.alca && arraste.moveu) {
      const { legenda, tipo } = arraste.alca;
      const valor = tipo === "inicio" ? legenda.inicio : legenda.fim;
      const x = xDeTempo(valor, largura);
      const texto = formatar(valor);

      c.font = "bold 11px system-ui, sans-serif";
      const larguraTexto = c.measureText(texto).width + 12;
      const posX = Math.min(largura - larguraTexto - 2, Math.max(2, x - larguraTexto / 2));
      const posY = tipo === "inicio" ? Y_FAIXA + ALTURA_FAIXA + 4 : ALTURA - 52;

      c.fillStyle = "rgba(0,0,0,0.8)";
      c.fillRect(posX, posY, larguraTexto, 18);
      c.fillStyle = tipo === "inicio" ? "#72f0b0" : "#ffb454";
      c.textAlign = "left";
      c.fillText(texto, posX + 6, posY + 9);
    }

    /* Guia ao arrastar uma linha da bandeja */
    if (guiaSolta !== null) {
      const xGuia = xDeTempo(guiaSolta, largura);
      const textoGuia = formatar(guiaSolta);

      c.save();
      c.setLineDash([5, 4]);
      c.strokeStyle = "#ffd84a";
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(xGuia, 0);
      c.lineTo(xGuia, ALTURA);
      c.stroke();
      c.restore();

      c.font = "bold 11px system-ui, sans-serif";
      const larguraGuia = c.measureText(textoGuia).width + 12;
      const posGuia = Math.min(largura - larguraGuia - 2, Math.max(2, xGuia - larguraGuia / 2));

      c.fillStyle = "rgba(0,0,0,0.85)";
      c.fillRect(posGuia, ALTURA - 24, larguraGuia, 18);
      c.fillStyle = "#ffd84a";
      c.textAlign = "left";
      c.fillText(textoGuia, posGuia + 6, ALTURA - 15);
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
          <div class="ondas-modos" role="group" aria-label="Modo da tela">
            <button id="ondasModoOndas" type="button" class="ondas-modo ativo" aria-pressed="true">Ondas</button>
            <button id="ondasModoSolta" type="button" class="ondas-modo" aria-pressed="false">Letra solta</button>
          </div>
          <span id="ondasStatus" class="ondas-status"></span>
          <button id="fecharOndas" type="button" aria-label="Fechar Ondas">×</button>
        </div>

        <div class="ondas-agora" id="ondasAgora">—</div>

        <div class="ondas-wave-wrap">
          <canvas id="ondasCanvas"></canvas>
        </div>

        <p class="ondas-dica">
          Arraste a onda para andar no tempo e toque nela para posicionar o áudio.
          Bolinha verde (metade de cima) é o início da legenda e laranja (metade de baixo) é o fim.
          Um anel amarelo marca uma âncora.
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

        <div class="ondas-secao" id="ondasSecaoSolta" hidden>
          <div class="ondas-secao-titulo">
            Letra solta
            <span id="ondasContSolta" class="counter">0 linhas</span>
          </div>

          <p class="ondas-dica" id="ondasDicaSolta"></p>

          <div id="ondasBandeja" class="ondas-bandeja"></div>

          <div class="ondas-botoes">
            <button id="ondasSoltaAgora" type="button" class="primary-button">Colocar no tempo atual</button>
            <button id="ondasSoltaDoCampo" type="button" class="secondary-button">Usar letra do campo Letra</button>
            <button id="ondasSoltaTirar" type="button" class="secondary-button">Tirar todas as legendas do lugar</button>
            <button id="ondasSoltaDesfazer" type="button" class="secondary-button">Desfazer</button>
          </div>

          <div class="ondas-ajustes">
            <label class="check-row">
              <input type="checkbox" id="ondasLigar" checked>
              <span>Ligar com a linha anterior quando o intervalo for curto (até 2,5 s)</span>
            </label>

            <label class="ondas-passo">Compensar atraso do clique
              <select id="ondasAntecipar">
                <option value="0">0 s</option>
                <option value="0.15">0,15 s</option>
                <option value="0.3" selected>0,3 s</option>
                <option value="0.5">0,5 s</option>
              </select>
            </label>
          </div>
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
            <button id="ondasTocarLinha" type="button" class="secondary-button">▶ Tocar esta linha</button>
            <button id="ondasAncora" type="button" class="secondary-button">◆ Fixar âncora</button>
            <button id="ondasDevolver" type="button" class="secondary-button">↩ Devolver à bandeja</button>
          </div>
        </div>

        <div class="ondas-secao" id="ondasSecaoEsticar">
          <div class="ondas-secao-titulo">Esticar o restante</div>

          <label class="check-row">
            <input type="checkbox" id="ondasColadas" checked>
            <span>Manter linhas coladas (o fim de uma continua sendo o início da próxima)</span>
          </label>

          <p class="help-text" id="ondasInfoAncoras"></p>

          <div class="ondas-botoes">
            <button id="ondasEsticar" type="button" class="primary-button">Esticar o restante</button>
            <button id="ondasDesfazer" type="button" class="secondary-button">Desfazer</button>
            <button id="ondasLimpar" type="button" class="secondary-button">Limpar âncoras</button>
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

  function atualizarPainel() {
    const legenda = legendas[indiceSelecionado] || null;

    const textoSel = el("ondasTextoSel");
    const valInicio = el("ondasValInicio");
    const valFim = el("ondasValFim");
    if (!textoSel) return;

    if (legenda) {
      textoSel.textContent = (indiceSelecionado + 1) + ". " + (legenda.texto || "").replace(/\s+/g, " ");
      valInicio.textContent = formatar(legenda.inicio);
      valFim.textContent = formatar(legenda.fim);
    } else {
      textoSel.textContent = legendas.length
        ? "Toque em uma legenda na faixa superior para selecionar."
        : "Crie as legendas antes de ajustar os tempos.";
      valInicio.textContent = "--";
      valFim.textContent = "--";
    }

    el("ondasModal").querySelectorAll("[data-ajuste], #ondasInicioAgora, #ondasFimAgora, #ondasTocarLinha, #ondasAncora, #ondasDevolver")
      .forEach(botao => { botao.disabled = !legenda; });

    el("ondasAnterior").disabled = !(indiceSelecionado > 0);
    el("ondasProxima").disabled = !(indiceSelecionado >= 0 && indiceSelecionado < legendas.length - 1);

    const ancoraAtiva = legenda && ancoras.has(legenda);
    el("ondasAncora").textContent = ancoraAtiva ? "◇ Soltar âncora" : "◆ Fixar âncora";

    el("ondasDesfazer").disabled = !desfazerEsticamento;

    el("ondasInfoAncoras").textContent = ancoras.size
      ? "Âncoras: " + ancoras.size + ". Linhas ajustadas à mão: " + new Set([...inicioEditado, ...fimEditado]).size +
        ". Ao esticar, as demais legendas são distribuídas proporcionalmente entre as âncoras."
      : "Ajuste uma linha que esteja fora do tempo (ou toque em Fixar âncora numa linha certa). " +
        "Depois de marcar duas ou mais, use Esticar o restante para corrigir as demais proporcionalmente.";
  }

  function atualizarRotulos(t) {
    const tempo = el("ondasTempo");
    const agora = el("ondasAgora");
    const play = el("ondasPlay");
    if (!tempo) return;

    tempo.textContent = formatar(t) + " / " + formatar(duracaoTotal());
    play.textContent = audio.paused ? "▶ Tocar" : "Ⅱ Pausar";

    const ativa = legendas.find(l => t >= l.inicio && t < l.fim);
    agora.textContent = ativa
      ? "Agora: " + String(ativa.texto || "").replace(/\s+/g, " ")
      : "Agora: (sem legenda)";
  }

  function centralizar(legenda) {
    inicioVisivel = limitar(legenda.inicio - janela * 0.25, 0, maxInicioVisivel());
    atualizarSliders();
    precisaDesenhar = true;
  }

  function irParaLegenda(i) {
    if (i < 0 || i >= legendas.length) return;
    selecionarLegenda(i);
    centralizar(legendas[i]);
    atualizarPainel();
  }

  function aposEdicao() {
    desenharLista();
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
    if (!legenda || !audio.src) return;

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

  function acharAlca(x, y, largura) {
    const metade = ALTURA / 2;
    const tipo = y < metade ? "inicio" : "fim";
    let melhor = null;
    let distancia = RAIO_TOQUE + 1;

    legendas.forEach((legenda, i) => {
      const xe = xDeTempo(tipo === "inicio" ? legenda.inicio : legenda.fim, largura);
      const d = Math.abs(x - xe) - (i === indiceSelecionado ? 3 : 0);

      if (d < distancia) {
        distancia = d;
        melhor = { legenda, i, tipo };
      }
    });

    return melhor;
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
        if (!legenda) return;

        const passo = Number(el("ondasPasso").value) || 0.1;
        const delta = Number(botao.dataset.sinal) * passo;

        if (botao.dataset.ajuste === "inicio") moverInicio(legenda, legenda.inicio + delta);
        else moverFim(legenda, legenda.fim + delta);

        aposEdicao();
      });
    });

    el("ondasInicioAgora").addEventListener("click", () => {
      const legenda = legendas[indiceSelecionado];
      if (!legenda) return;
      moverInicio(legenda, audio.currentTime || 0);
      aposEdicao();
    });

    el("ondasFimAgora").addEventListener("click", () => {
      const legenda = legendas[indiceSelecionado];
      if (!legenda) return;
      moverFim(legenda, audio.currentTime || 0);
      aposEdicao();
    });

    el("ondasAncora").addEventListener("click", () => {
      const legenda = legendas[indiceSelecionado];
      if (!legenda) return;

      if (ancoras.has(legenda)) {
        ancoras.delete(legenda);
        inicioEditado.delete(legenda);
        fimEditado.delete(legenda);
      } else {
        ancoras.add(legenda);
      }

      atualizarPainel();
      precisaDesenhar = true;
    });

    el("ondasEsticar").addEventListener("click", esticarRestante);
    el("ondasDesfazer").addEventListener("click", desfazer);
    el("ondasLimpar").addEventListener("click", limparAncoras);

    /* ----- Modo Letra solta ----- */
    el("ondasModoOndas").addEventListener("click", () => definirModo("ondas"));
    el("ondasModoSolta").addEventListener("click", () => definirModo("solta"));

    el("ondasSoltaAgora").addEventListener("click", () => {
      const id = armada && bandeja.some(c => c.id === armada)
        ? armada
        : (bandeja[0] ? bandeja[0].id : null);

      if (!id) {
        aviso("Não há linhas na bandeja. Use \"Usar letra do campo Letra\" ou \"Tirar todas as legendas do lugar\".");
        return;
      }

      const antecipar = Number(el("ondasAntecipar").value) || 0;
      colocarLinha(id, Math.max(0, (audio.currentTime || 0) - (audio.paused ? 0 : antecipar)), true);
    });

    el("ondasSoltaDoCampo").addEventListener("click", carregarDoCampoLetra);
    el("ondasSoltaTirar").addEventListener("click", tirarTodasDoLugar);
    el("ondasSoltaDesfazer").addEventListener("click", desfazerSolta);
    el("ondasDevolver").addEventListener("click", devolverSelecionada);

    el("ondasBandeja").addEventListener("wheel", evento => {
      if (Math.abs(evento.deltaY) > Math.abs(evento.deltaX)) {
        el("ondasBandeja").scrollLeft += evento.deltaY;
        evento.preventDefault();
      }
    }, { passive: false });

    document.addEventListener("lyric:audio-alterado", () => {
      pilhaSolta.length = 0;
      picos = null;
      picosSrc = null;
      guiaSolta = null;
      if (el("ondasModal")) {
        atualizarPainel();
        precisaDesenhar = true;
      }
    });

    canvasOndas.addEventListener("pointerdown", evento => {
      const retangulo = canvasOndas.getBoundingClientRect();
      const x = evento.clientX - retangulo.left;
      const y = evento.clientY - retangulo.top;
      const alca = acharAlca(x, y, retangulo.width);

      canvasOndas.setPointerCapture(evento.pointerId);

      arraste = {
        id: evento.pointerId,
        x0: x,
        y0: y,
        moveu: false,
        alca,
        inicioVisivel0: inicioVisivel,
        colada: undefined
      };

      if (alca) {
        const i = alca.i;

        if (coladasAtivas()) {
          arraste.colada = alca.tipo === "inicio" ? coladaAnterior(i) : coladaSeguinte(i);
        } else {
          arraste.colada = null;
        }

        if (indiceSelecionado !== i) {
          indiceSelecionado = i;
          $("linhaSelecionada").value = String(i);
          atualizarPainel();
        }
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

      if (arraste.alca) {
        const { legenda, tipo } = arraste.alca;
        const t = Math.max(0, tempoDeX(x, retangulo.width));

        if (tipo === "inicio") moverInicio(legenda, t, arraste.colada);
        else moverFim(legenda, t, arraste.colada);

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
        if (atual.alca) aposEdicao();
        precisaDesenhar = true;
        return;
      }

      if (atual.alca) {
        selecionarLegenda(atual.alca.i);
        atualizarPainel();
        precisaDesenhar = true;
        return;
      }

      const t = tempoDeX(x, retangulo.width);

      if (y >= Y_FAIXA && y <= Y_FAIXA + ALTURA_FAIXA) {
        const indice = legendas.findIndex(l => t >= l.inicio && t < l.fim);

        if (indice >= 0) {
          selecionarLegenda(indice);
          atualizarPainel();
        }
      } else if (modo === "solta" && armada && bandeja.some(c => c.id === armada)) {
        colocarLinha(armada, t, true);
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

  /* ---------- Modo Letra solta ---------- */

  function novoIdChip() {
    contadorChips += 1;
    return "chip-" + Date.now().toString(36) + "-" + contadorChips;
  }

  function salvarSnapshotSolta() {
    pilhaSolta.push({
      lista: legendas.slice(),
      tempos: legendas.map(l => ({ legenda: l, inicio: l.inicio, fim: l.fim })),
      bandeja: bandeja.map(c => ({ ...c })),
      indice: indiceSelecionado
    });

    if (pilhaSolta.length > 30) pilhaSolta.shift();
  }

  function definirModo(novo) {
    modo = novo;

    const botaoOndas = el("ondasModoOndas");
    const botaoSolta = el("ondasModoSolta");
    if (!botaoOndas) return;

    botaoOndas.classList.toggle("ativo", novo === "ondas");
    botaoSolta.classList.toggle("ativo", novo === "solta");
    botaoOndas.setAttribute("aria-pressed", String(novo === "ondas"));
    botaoSolta.setAttribute("aria-pressed", String(novo === "solta"));

    el("ondasSecaoSolta").hidden = novo !== "solta";
    el("ondasSecaoEsticar").hidden = novo === "solta";

    if (novo === "solta") renderBandeja();
    else guiaSolta = null;

    precisaDesenhar = true;
  }

  function atualizarDicaSolta() {
    const dica = el("ondasDicaSolta");
    const contador = el("ondasContSolta");
    if (!dica) return;

    contador.textContent = bandeja.length + (bandeja.length === 1 ? " linha" : " linhas");

    const chip = armada ? bandeja.find(c => c.id === armada) : null;

    dica.textContent = chip
      ? "Linha armada: \"" + chip.texto + "\". Toque na onda para soltar nesse ponto, ou use Colocar no tempo atual. Toque na linha de novo para desarmar."
      : "Arraste uma linha da bandeja até o ponto da onda onde ela começa a ser cantada. " +
        "Ou toque numa linha para armá-la e toque na onda. Dica: toque música e use Colocar no tempo atual na hora certa.";
  }

  function renderBandeja() {
    const area = el("ondasBandeja");
    if (!area) return;

    if (armada && !bandeja.some(c => c.id === armada)) armada = null;

    area.innerHTML = "";

    if (!bandeja.length) {
      const vazio = document.createElement("div");
      vazio.className = "empty-state";
      vazio.textContent = "Bandeja vazia. Use \"Usar letra do campo Letra\" ou \"Tirar todas as legendas do lugar\" para começar do zero.";
      area.appendChild(vazio);
      atualizarDicaSolta();
      return;
    }

    bandeja.forEach(chip => {
      const item = document.createElement("div");
      item.className = "ondas-chip" + (chip.id === armada ? " armada" : "");
      item.dataset.id = chip.id;
      item.setAttribute("role", "button");
      item.tabIndex = 0;
      item.title = chip.texto;
      item.textContent = chip.texto;

      item.addEventListener("pointerdown", evento => iniciarArrasteChip(evento, chip, item));
      item.addEventListener("pointermove", moverArrasteChip);
      item.addEventListener("pointerup", soltarArrasteChip);
      item.addEventListener("pointercancel", cancelarArrasteChip);

      item.addEventListener("keydown", evento => {
        if (evento.key === "Enter" || evento.key === " ") {
          evento.preventDefault();
          armada = armada === chip.id ? null : chip.id;
          renderBandeja();
        }
      });

      area.appendChild(item);
    });

    atualizarDicaSolta();
  }

  function sobreCanvasOndas(evento) {
    const canvasOndas = el("ondasCanvas");
    const r = canvasOndas.getBoundingClientRect();

    if (evento.clientX < r.left || evento.clientX > r.right ||
        evento.clientY < r.top || evento.clientY > r.bottom) {
      return null;
    }

    return {
      x: evento.clientX - r.left,
      largura: r.width
    };
  }

  function removerFantasma() {
    if (arrasteChip && arrasteChip.fantasma) arrasteChip.fantasma.remove();
  }

  function iniciarArrasteChip(evento, chip, item) {
    if (evento.pointerType === "mouse" && evento.button !== 0) return;

    arrasteChip = {
      id: chip.id,
      texto: chip.texto,
      item,
      pointerId: evento.pointerId,
      x0: evento.clientX,
      y0: evento.clientY,
      moveu: false,
      fantasma: null
    };

    try { item.setPointerCapture(evento.pointerId); } catch (_) {}
  }

  function moverArrasteChip(evento) {
    const a = arrasteChip;
    if (!a || a.pointerId !== evento.pointerId) return;

    if (!a.moveu && Math.hypot(evento.clientX - a.x0, evento.clientY - a.y0) > 6) {
      a.moveu = true;
      a.fantasma = document.createElement("div");
      a.fantasma.className = "ondas-fantasma";
      a.fantasma.textContent = a.texto;
      document.body.appendChild(a.fantasma);
      a.item.classList.add("arrastando");
    }

    if (!a.moveu) return;

    evento.preventDefault();
    a.fantasma.style.left = evento.clientX + "px";
    a.fantasma.style.top = evento.clientY + "px";

    const sobre = sobreCanvasOndas(evento);
    guiaSolta = sobre ? Math.max(0, tempoDeX(sobre.x, sobre.largura)) : null;
    precisaDesenhar = true;
  }

  function soltarArrasteChip(evento) {
    const a = arrasteChip;
    if (!a || a.pointerId !== evento.pointerId) return;

    removerFantasma();
    a.item.classList.remove("arrastando");
    arrasteChip = null;
    guiaSolta = null;
    precisaDesenhar = true;

    if (!a.moveu) {
      armada = armada === a.id ? null : a.id;
      renderBandeja();
      return;
    }

    const sobre = sobreCanvasOndas(evento);

    if (sobre) {
      colocarLinha(a.id, Math.max(0, tempoDeX(sobre.x, sobre.largura)), false);
    }
  }

  function cancelarArrasteChip(evento) {
    const a = arrasteChip;
    if (!a || a.pointerId !== evento.pointerId) return;

    removerFantasma();
    a.item.classList.remove("arrastando");
    arrasteChip = null;
    guiaSolta = null;
    precisaDesenhar = true;
  }

  function colocarLinha(id, t, armarProxima) {
    const pos = bandeja.findIndex(c => c.id === id);
    if (pos < 0) return;

    const total = duracaoTotal();
    if (total > 0) t = Math.min(t, Math.max(0, total - MIN_DURACAO));
    t = Math.max(0, t);

    salvarSnapshotSolta();

    const chip = bandeja.splice(pos, 1)[0];

    let indice = legendas.findIndex(l => l.inicio > t);
    if (indice < 0) indice = legendas.length;

    const anterior = legendas[indice - 1];
    const proxima = legendas[indice];

    let fim = t + DURACAO_PADRAO;
    if (proxima) fim = Math.min(fim, proxima.inicio);
    if (total > 0) fim = Math.min(fim, total);
    if (fim - t < MIN_DURACAO) fim = t + MIN_DURACAO;

    if (anterior) {
      if (anterior.fim > t) {
        anterior.fim = Math.max(anterior.inicio + MIN_DURACAO, t);
      } else if (el("ondasLigar").checked && t - anterior.fim <= LIMITE_LIGAR) {
        anterior.fim = t;
      }
    }

    const nova = {
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + contadorChips,
      texto: chip.texto,
      inicio: t,
      fim,
      ordem: chip.ordem
    };

    legendas.splice(indice, 0, nova);
    indiceSelecionado = indice;

    if (armarProxima) armada = bandeja[0] ? bandeja[0].id : null;
    else if (armada === id) armada = null;

    renderBandeja();
    desenharLista();
    renderizar();
    atualizarPainel();
    precisaDesenhar = true;

    aviso("Linha colocada em " + formatar(t) + ". Faltam " + bandeja.length + (bandeja.length === 1 ? " linha." : " linhas."));
  }

  function devolverSelecionada() {
    const i = indiceSelecionado;
    const legenda = legendas[i];
    if (!legenda) return;

    salvarSnapshotSolta();

    const ordem = Number.isFinite(legenda.ordem) ? legenda.ordem : i;

    legendas.splice(i, 1);
    limparReferencias();

    let pos = bandeja.findIndex(c => c.ordem > ordem);
    if (pos < 0) pos = bandeja.length;
    bandeja.splice(pos, 0, { id: novoIdChip(), texto: legenda.texto, ordem });

    indiceSelecionado = legendas.length ? Math.min(i, legendas.length - 1) : -1;

    if (modo !== "solta") definirModo("solta");

    renderBandeja();
    desenharLista();
    renderizar();
    atualizarPainel();
    precisaDesenhar = true;
    aviso("Legenda devolvida à bandeja.");
  }

  function carregarDoCampoLetra() {
    const linhas = String($("letra").value || "")
      .split(/\r?\n/)
      .map(linha => linha.trim())
      .filter(Boolean);

    if (!linhas.length) {
      aviso("O campo Letra está vazio. Cole a letra na seção 02 primeiro.");
      return;
    }

    salvarSnapshotSolta();

    bandeja = linhas.map((texto, ordem) => ({ id: novoIdChip(), texto, ordem }));
    armada = null;

    renderBandeja();
    atualizarPainel();
    aviso(linhas.length + (linhas.length === 1 ? " linha pronta" : " linhas prontas") + " na bandeja.");
  }

  function tirarTodasDoLugar() {
    if (!legendas.length) {
      aviso("Não há legendas posicionadas para tirar do lugar.");
      return;
    }

    salvarSnapshotSolta();

    const movidas = legendas.map((legenda, indice) => ({
      id: novoIdChip(),
      texto: legenda.texto,
      ordem: Number.isFinite(legenda.ordem) ? legenda.ordem : indice
    }));

    const restantes = bandeja.map((chip, i) => ({ ...chip, ordem: movidas.length + i }));

    legendas = [];
    indiceSelecionado = -1;
    bandeja = [...movidas, ...restantes];
    armada = null;

    limparReferencias();
    renderBandeja();
    desenharLista();
    renderizar();
    atualizarPainel();
    precisaDesenhar = true;
    aviso("Todas as legendas foram para a bandeja. Agora é só encaixar uma a uma.");
  }

  function desfazerSolta() {
    const s = pilhaSolta.pop();

    if (!s) {
      aviso("Não há nada para desfazer.");
      return;
    }

    s.tempos.forEach(item => {
      item.legenda.inicio = item.inicio;
      item.legenda.fim = item.fim;
    });

    legendas = s.lista;
    bandeja = s.bandeja;
    indiceSelecionado = s.indice;
    armada = null;

    limparReferencias();
    renderBandeja();
    desenharLista();
    renderizar();
    atualizarPainel();
    precisaDesenhar = true;
    aviso("Desfeito.");
  }

  function ciclo() {
    if (!aberto) return;

    const t = audio.currentTime || 0;

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
    definirModo(modo);
    limparReferencias();
    capturarBase();

    focoAnterior = document.activeElement;

    if (legendas.length && !legendas[indiceSelecionado]) {
      const t = audio.currentTime || 0;
      const atual = legendas.findIndex(l => t >= l.inicio && t < l.fim);
      selecionarLegenda(atual >= 0 ? atual : 0);
    }

    el("ondasModal").classList.add("aberto");
    document.body.classList.add("ondas-aberto");
    aberto = true;

    const referencia = legendas[indiceSelecionado];
    inicioVisivel = limitar(
      (referencia ? referencia.inicio : audio.currentTime || 0) - janela * 0.25,
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
    cancelAnimationFrame(rafOndas);
    tocarLinhaFim = null;
    arraste = null;
    guiaSolta = null;
    removerFantasma();
    arrasteChip = null;

    if (!audio.paused) audio.pause();

    const modal = el("ondasModal");
    if (modal) modal.classList.remove("aberto");
    document.body.classList.remove("ondas-aberto");

    if (focoAnterior && typeof focoAnterior.focus === "function") focoAnterior.focus();
  }

  /* Ponte para o salvamento automático (bandeja e modo da tela). */
  window._ondasEstado = {
    obter: () => ({ modo, bandeja: bandeja.map(c => ({ ...c })) }),
    definir: estado => {
      if (!estado) return;
      bandeja = Array.isArray(estado.bandeja) ? estado.bandeja.map(c => ({ ...c })) : [];
      armada = null;
      modo = estado.modo === "solta" ? "solta" : "ondas";
    }
  };

  const botaoAbrir = el("abrirOndas");
  if (botaoAbrir) botaoAbrir.addEventListener("click", abrir);
})();

/* =========================================================
   SALVAMENTO AUTOMÁTICO NO NAVEGADOR (IndexedDB)
   Guarda as configurações, as legendas, o trecho (trim) e os
   arquivos (áudio, vídeo de fundo, fonte, LUT e adesivos).
   Ao abrir a página de novo, o projeto é restaurado.
========================================================= */

(() => {
  "use strict";

  const NOME_DB = "lyric-studio";
  const INTERVALO_MS = 1500;

  const IDS_AJUSTES = [
    "letra", "letraComTempos",
    "formato", "resolucao", "qualidade",
    "posicaoTexto", "tamanhoTexto",
    "corFundo", "corTexto", "corDestaque",
    "fonteTexto", "animacaoTexto", "efeitoTexto", "corEfeito",
    "intensidadeEfeito", "velocidadeAnimTexto",
    "mostrarAudio", "recalcularSeguintes"
  ];

  const salvos = {};
  let dbPromessa = null;
  let pronto = false;
  let ocupado = false;
  let desativado = false;
  let ultimaAssinatura = "";
  let avisouErro = false;

  function indicador(texto) {
    const campo = $("estadoSalvo");
    if (campo) campo.textContent = texto;
  }

  function horaAgora() {
    const d = new Date();
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  /* ---------- IndexedDB ---------- */

  function abrirDB() {
    if (dbPromessa) return dbPromessa;

    dbPromessa = new Promise((resolver, rejeitar) => {
      if (!window.indexedDB) {
        rejeitar(new Error("IndexedDB indisponível"));
        return;
      }

      const pedido = indexedDB.open(NOME_DB, 1);
      pedido.onupgradeneeded = () => pedido.result.createObjectStore("kv");
      pedido.onsuccess = () => resolver(pedido.result);
      pedido.onerror = () => rejeitar(pedido.error);
      pedido.onblocked = () => rejeitar(new Error("Banco bloqueado por outra aba"));
    });

    return dbPromessa;
  }

  function transacao(modoTx, fn) {
    return abrirDB().then(db => new Promise((resolver, rejeitar) => {
      const t = db.transaction("kv", modoTx);
      const pedido = fn(t.objectStore("kv"));
      t.oncomplete = () => resolver(pedido ? pedido.result : undefined);
      t.onerror = () => rejeitar(t.error);
      t.onabort = () => rejeitar(t.error || new Error("Transação cancelada"));
    }));
  }

  const idbLer = chave => transacao("readonly", s => s.get(chave));
  const idbGravar = (chave, valor) => transacao("readwrite", s => s.put(valor, chave));
  const idbApagar = chave => transacao("readwrite", s => s.delete(chave));

  async function blobDe(url) {
    const resposta = await fetch(url);
    return resposta.blob();
  }

  /* ---------- Coleta do estado ---------- */

  function coletarEstado() {
    const ajustes = {};

    IDS_AJUSTES.forEach(id => {
      const campo = $(id);
      if (!campo) return;
      ajustes[id] = campo.type === "checkbox" ? campo.checked : campo.value;
    });

    const trim = window._editorTrim;

    return {
      versao: 1,
      ajustes,
      legendas: legendas.map(l => ({
        id: l.id,
        texto: l.texto,
        inicio: l.inicio,
        fim: l.fim,
        ordem: l.ordem
      })),
      indice: indiceSelecionado,
      stickers: elementosVisuais.map(i => ({
        id: i.id,
        nome: i.nome,
        x: i.x,
        y: i.y,
        largura: i.largura,
        altura: i.altura,
        escala: i.escala,
        rotacao: i.rotacao,
        animacao: i.animacao
      })),
      animacaoImportada: animacaoTextoImportada,
      trim: trim && obterDuracao()
        ? { inicio: trim.getStart(), fim: trim.getEnd() }
        : null,
      ondas: window._ondasEstado ? window._ondasEstado.obter() : null,
      tempo: audio.currentTime || 0
    };
  }

  function assinatura(estado) {
    return JSON.stringify({ ...estado, tempo: 0 });
  }

  /* ---------- Arquivos ---------- */

  function slotsAtuais() {
    const slots = new Map();

    if (audioURL) {
      const url = audioURL;
      slots.set("audio", {
        fonte: url,
        obter: async () => ({ blob: await blobDe(url), nome: $("nomeAudio").textContent })
      });
    }

    if (videoURL) {
      const url = videoURL;
      slots.set("video", {
        fonte: url,
        obter: async () => ({ blob: await blobDe(url), nome: $("nomeVideo").textContent })
      });
    }

    if (fonteURL && fontePersonalizada) {
      const url = fonteURL;
      slots.set("fonte", {
        fonte: url,
        obter: async () => ({
          blob: await blobDe(url),
          nome: ($("fonteTexto").querySelector('option[value="custom"]') || {}).textContent || "Fonte importada"
        })
      });
    }

    if (lut) {
      const atual = lut;
      slots.set("lut", {
        fonte: atual,
        obter: async () => ({ lut: atual, nome: $("nomeLUT").textContent })
      });
    }

    elementosVisuais.forEach(item => {
      if (!item.url) return;
      const url = item.url;
      slots.set("sticker:" + item.id, {
        fonte: url,
        obter: async () => ({ blob: await blobDe(url), nome: item.nome })
      });
    });

    return slots;
  }

  function arquivosPendentes() {
    const atuais = slotsAtuais();

    for (const [chave, slot] of atuais) {
      if (salvos[chave] !== slot.fonte) return true;
    }

    return Object.keys(salvos).some(chave => !atuais.has(chave));
  }

  async function salvarArquivos() {
    const atuais = slotsAtuais();

    for (const [chave, slot] of atuais) {
      if (salvos[chave] === slot.fonte) continue;

      try {
        const valor = await slot.obter();
        await idbGravar(chave, valor);
        salvos[chave] = slot.fonte;
      } catch (erro) {
        tratarErro(erro);
      }
    }

    for (const chave of Object.keys(salvos)) {
      if (!atuais.has(chave)) {
        await idbApagar(chave);
        delete salvos[chave];
      }
    }
  }

  function tratarErro(erro) {
    console.warn("Salvamento automático:", erro);

    if (avisouErro) return;
    avisouErro = true;

    const cheio = erro && (erro.name === "QuotaExceededError" || /quota/i.test(String(erro.message)));

    indicador("Não foi possível salvar");
    mensagem(
      cheio
        ? "O navegador está sem espaço para salvar o projeto automaticamente. Libere espaço ou use arquivos menores."
        : "Não foi possível salvar o projeto automaticamente neste navegador."
    );
  }

  /* ---------- Ciclo de salvamento ---------- */

  async function ciclo(forcar) {
    if (!pronto || ocupado || desativado || exportando) return;

    const estado = coletarEstado();
    const sig = assinatura(estado);

    if (!forcar && sig === ultimaAssinatura && !arquivosPendentes()) return;

    ocupado = true;
    indicador("Salvando...");

    try {
      await salvarArquivos();
      await idbGravar("estado", estado);
      ultimaAssinatura = sig;
      avisouErro = false;
      indicador("Salvo automaticamente às " + horaAgora());
    } catch (erro) {
      tratarErro(erro);
    } finally {
      ocupado = false;
    }
  }

  function salvarEstadoRapido() {
    if (!pronto || desativado) return;
    idbGravar("estado", coletarEstado()).catch(() => {});
  }

  /* ---------- Restauração ---------- */

  function aplicarAjustes(ajustes) {
    IDS_AJUSTES.forEach(id => {
      const campo = $(id);
      if (!campo || !(id in ajustes)) return;

      if (campo.type === "checkbox") {
        campo.checked = Boolean(ajustes[id]);
      } else {
        campo.value = ajustes[id];
      }

      campo.dispatchEvent(new Event("input", { bubbles: true }));
      campo.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  async function restaurarFonte(registro) {
    if (!registro || !registro.blob) return;

    const url = URL.createObjectURL(registro.blob);

    try {
      const face = new FontFace("FonteLyricCustom", `url("${url}")`);
      await face.load();
      document.fonts.add(face);

      fonteURL = url;
      fontePersonalizada = "FonteLyricCustom";

      const opcao = $("fonteTexto").querySelector('option[value="custom"]');
      if (opcao) opcao.textContent = registro.nome || "Fonte importada";
      $("nomeFonte").textContent = "Fonte carregada: " + (registro.nome || "fonte importada");

      salvos.fonte = url;
    } catch (erro) {
      URL.revokeObjectURL(url);
      console.warn("Não foi possível restaurar a fonte:", erro);
    }
  }

  function restaurarVideo(registro) {
    if (!registro || !registro.blob) return;

    videoURL = URL.createObjectURL(registro.blob);
    videoFundo.src = videoURL;
    videoFundo.load();
    $("nomeVideo").textContent = registro.nome || "Vídeo de fundo restaurado";
    salvos.video = videoURL;

    videoFundo.onloadeddata = () => {
      videoFundo.currentTime = 0;
      videoFundo.play().catch(() => {});
      renderizar();
    };
  }

  async function restaurarAudio(registro) {
    if (!registro || !registro.blob) return;

    audioURL = URL.createObjectURL(registro.blob);
    audio.src = audioURL;
    audio.load();
    $("nomeAudio").textContent = registro.nome || "Áudio restaurado";
    salvos.audio = audioURL;

    await esperarMetadadosAudio();
    atualizarTempo();
  }

  async function restaurarAdesivos(lista) {
    for (const meta of lista || []) {
      const registro = await idbLer("sticker:" + meta.id);
      if (!registro || !registro.blob) continue;

      const url = URL.createObjectURL(registro.blob);

      const imagem = await new Promise(resolver => {
        const nova = new Image();
        nova.onload = () => resolver(nova);
        nova.onerror = () => resolver(null);
        nova.src = url;
      });

      if (!imagem) {
        URL.revokeObjectURL(url);
        continue;
      }

      elementosVisuais.push({ ...meta, imagem, url });
      contadorImagens = Math.max(contadorImagens, Number(meta.id) || 0);
      salvos["sticker:" + meta.id] = url;
    }
  }

  async function restaurar() {
    const estado = await idbLer("estado");
    if (!estado || estado.versao !== 1) return false;

    /* Animação do texto importada precisa existir antes do seletor. */
    if (estado.animacaoImportada) {
      const preset = normalizarPresetAnimacao(estado.animacaoImportada);

      if (preset) {
        animacaoTextoImportada = preset;

        const seletor = $("animacaoTexto");
        let opcao = seletor.querySelector('option[value="importada"]');

        if (!opcao) {
          opcao = document.createElement("option");
          opcao.value = "importada";
          seletor.appendChild(opcao);
        }

        opcao.textContent = "Importada: " + preset.nome;
        $("estadoAnimacaoTexto").textContent = "Animação \"" + preset.nome + "\" restaurada.";
      }
    }

    await restaurarFonte(await idbLer("fonte"));

    aplicarAjustes(estado.ajustes || {});

    const registroLut = await idbLer("lut");

    if (registroLut && registroLut.lut) {
      lut = registroLut.lut;
      $("nomeLUT").textContent = registroLut.nome || "LUT restaurada";
      salvos.lut = lut;
    }

    restaurarVideo(await idbLer("video"));
    await restaurarAudio(await idbLer("audio"));
    await restaurarAdesivos(estado.stickers);

    legendas = Array.isArray(estado.legendas)
      ? estado.legendas.map(l => ({ ...l }))
      : [];

    indiceSelecionado = legendas.length
      ? Math.min(Math.max(0, Number(estado.indice) || 0), legendas.length - 1)
      : -1;

    if (window._ondasEstado) window._ondasEstado.definir(estado.ondas);

    atualizarSeletorLegendas();
    desenharLista();

    const duracao = obterDuracao();

    if (duracao && estado.trim && window._editorTrim) {
      window._editorTrim.setStartEnd(
        Number(estado.trim.inicio) || 0,
        Number(estado.trim.fim) || duracao
      );
    }

    if (duracao && Number.isFinite(estado.tempo)) {
      audio.currentTime = Math.min(Math.max(0, estado.tempo), Math.max(0, duracao - 0.01));
    }

    renderizar();

    mensagem(
      "Projeto anterior restaurado automaticamente" +
      (legendas.length ? " (" + legendas.length + (legendas.length === 1 ? " legenda)." : " legendas).") : ".")
    );

    return true;
  }

  /* ---------- Novo projeto ---------- */

  function ligarNovoProjeto() {
    const botao = $("novoProjeto");
    if (!botao) return;

    botao.addEventListener("click", async () => {
      if (!confirm("Começar um projeto novo? Isso apaga o projeto salvo neste navegador.")) return;

      desativado = true;

      try {
        const db = await abrirDB();
        db.close();
      } catch (_) {}

      const recarregar = () => location.reload();
      const pedido = indexedDB.deleteDatabase(NOME_DB);
      pedido.onsuccess = recarregar;
      pedido.onerror = recarregar;
      pedido.onblocked = recarregar;
    });
  }

  /* ---------- Início ---------- */

  async function iniciar() {
    ligarNovoProjeto();

    try {
      await abrirDB();
    } catch (erro) {
      indicador("Salvamento automático indisponível");
      console.warn("Salvamento automático indisponível:", erro);
      return;
    }

    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }

    try {
      await restaurar();
    } catch (erro) {
      console.warn("Não foi possível restaurar o projeto:", erro);
    }

    ultimaAssinatura = assinatura(coletarEstado());
    pronto = true;
    indicador("Salvamento automático ativo");

    setInterval(() => ciclo(false), INTERVALO_MS);

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") salvarEstadoRapido();
    });

    window.addEventListener("pagehide", salvarEstadoRapido);
  }

  iniciar();
})();
