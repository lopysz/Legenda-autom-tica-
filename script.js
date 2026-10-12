
"use strict";

const $ = id => document.getElementById(id);

const audio = $("audio");
const canvas = $("canvas");
const ctx = canvas.getContext("2d");

let arquivoURL = null;
let legendas = [];
let audioContext = null;
let sourceNode = null;
let audioDestination = null;
let recorder = null;
let chunks = [];
let exportando = false;
let animacao = null;

const fmt = segundos => {
  if (!Number.isFinite(segundos)) return "00:00";
  const s = Math.max(0, Math.floor(segundos));
  return String(Math.floor(s / 60)).padStart(2, "0")
    + ":" + String(s % 60).padStart(2, "0");
};

function mensagem(texto) {
  $("mensagem").textContent = texto;
}

function linhaAtiva() {
  const t = audio.currentTime;
  let ativa = null;

  for (const item of legendas) {
    if (t >= item.inicio && t < item.fim) ativa = item;
  }

  return ativa;
}

function desenharTexto(texto, x, y, maxLargura, tamanho) {
  const palavras = texto.split(/\s+/);
  const linhas = [];
  let linha = "";

  for (const palavra of palavras) {
    const teste = linha ? linha + " " + palavra : palavra;

    if (ctx.measureText(teste).width > maxLargura && linha) {
      linhas.push(linha);
      linha = palavra;
    } else {
      linha = teste;
    }
  }

  if (linha) linhas.push(linha);

  const altura = tamanho * 1.3;
  const total = linhas.length * altura;

  linhas.forEach((textoLinha, i) => {
    ctx.fillText(textoLinha, x, y - total / 2 + i * altura + altura / 2);
  });
}

function renderizar() {
  const w = canvas.width;
  const h = canvas.height;

  const fundo = $("corFundo").value;
  const corTexto = $("corTexto").value;
  const destaque = $("corDestaque").value;
  const tamanho = Number($("tamanhoTexto").value);
  const posicao = $("posicaoTexto").value;

  ctx.fillStyle = fundo;
  ctx.fillRect(0, 0, w, h);

  const t = audio.currentTime;
  const atual = linhaAtiva();

  // Visualizador simples baseado na intensidade do áudio.
  if ($("mostrarAudio").checked && audioContext && sourceNode) {
    const analyser = window._lyricAnalyser;

    if (analyser) {
      const dados = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(dados);

      const barras = 48;
      const largura = w * 0.76 / barras;
      const espacamento = largura * 0.25;
      const xInicial = (w - barras * largura) / 2;

      for (let i = 0; i < barras; i++) {
        const indice = Math.floor(i * dados.length / barras);
        const valor = dados[indice] / 255;
        const altura = Math.max(5, valor * h * 0.09);
        const x = xInicial + i * largura;
        const y = h * 0.22 - altura / 2;

        ctx.fillStyle = destaque;
        ctx.globalAlpha = 0.35 + valor * 0.65;
        ctx.fillRect(
          x, y,
          Math.max(2, largura - espacamento),
          altura
        );
      }

      ctx.globalAlpha = 1;
    }
  }

  if (atual) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `bold ${tamanho}px Arial, sans-serif`;
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(3, tamanho / 12);
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.fillStyle = corTexto;

    let y;

    if (posicao === "top") {
      y = h * 0.22;
    } else if (posicao === "bottom") {
      y = h * 0.78;
    } else {
      y = h * 0.53;
    }

    const palavras = atual.texto.split(/\s+/);
    const larguraMaxima = w * 0.84;
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

    const alturaLinha = tamanho * 1.3;
    const inicioY = y - ((linhas.length - 1) * alturaLinha) / 2;

    linhas.forEach((textoLinha, i) => {
      const yy = inicioY + i * alturaLinha;

      ctx.strokeText(textoLinha, w / 2, yy);
      ctx.fillText(textoLinha, w / 2, yy);
    });
  } else {
    ctx.fillStyle = corTexto;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = 0.65;
    ctx.font = `bold ${Math.max(22, tamanho * 0.7)}px Arial`;
    ctx.fillText("LYRIC STUDIO", w / 2, h / 2);
    ctx.globalAlpha = 1;
  }

  // Indicador de progresso.
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    const progresso = t / audio.duration;

    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(0, h - 8, w, 8);

    ctx.fillStyle = destaque;
    ctx.fillRect(0, h - 8, w * progresso, 8);
  }

  $("tempoAtual").textContent = fmt(t);

  if (Number.isFinite(audio.duration)) {
    $("duracao").textContent = fmt(audio.duration);
    $("seek").value = audio.duration
      ? t / audio.duration * 100 : 0;
  }

  atualizarLinhasAtivas();

  animacao = requestAnimationFrame(renderizar);
}

function atualizarLinhasAtivas() {
  const ativa = linhaAtiva();

  document.querySelectorAll(".lyric-row").forEach(el => {
    el.classList.toggle(
      "active",
      ativa && Number(el.dataset.index) === ativa.index
    );
  });

  if (ativa && $("linhaSelecionada").value !== String(ativa.index)) {
    $("linhaSelecionada").value = String(ativa.index);
  }
}

function configurarFormato() {
  if ($("formato").value === "vertical") {
    canvas.width = 720;
    canvas.height = 1280;
    $("resolucao").textContent = "720 × 1280";
  } else {
    canvas.width = 1280;
    canvas.height = 720;
    $("resolucao").textContent = "1280 × 720";
  }

  renderizarAgora();
}

function renderizarAgora() {
  // O loop principal desenha continuamente.
}

function criarLinhas() {
  const textos = $("letra").value
    .split(/\r?\n/)
    .map(t => t.trim())
    .filter(Boolean);

  if (!textos.length) {
    mensagem("Cole a letra antes de criar as linhas.");
    return;
  }

  legendas = textos.map((texto, index) => ({
    index,
    texto,
    inicio: 0,
    fim: 0
  }));

  // Tempos iniciais aproximados. Ajuste depois ouvindo a música.
  const duracao = Number.isFinite(audio.duration) ? audio.duration : 0;

  legendas.forEach((item, i) => {
    item.inicio = duracao ? i * duracao / textos.length : i * 4;
    item.fim = duracao ? (i + 1) * duracao / textos.length : (i + 1) * 4;
  });

  desenharLista();
  mensagem("Linhas criadas. Reproduza a música e marque os inícios.");
}

function desenharLista() {
  const lista = $("listaLegendas");
  const seletor = $("linhaSelecionada");

  lista.replaceChildren();
  seletor.replaceChildren();

  legendas.forEach(item => {
    const opt = document.createElement("option");
    opt.value = String(item.index);
    opt.textContent = `${item.index + 1}. ${item.texto}`;
    seletor.appendChild(opt);

    const row = document.createElement("div");
    row.className = "lyric-row";
    row.dataset.index = String(item.index);

    const texto = document.createElement("div");
    texto.className = "lyric-text";
    texto.textContent = `${item.index + 1}. ${item.texto}`;

    const campos = document.createElement("div");
    campos.className = "time-fields";

    const inicio = document.createElement("input");
    inicio.type = "number";
    inicio.min = "0";
    inicio.step = "0.1";
    inicio.value = item.inicio.toFixed(1);
    inicio.setAttribute("aria-label", "Tempo inicial em segundos");

    const fim = document.createElement("input");
    fim.type = "number";
    fim.min = "0";
    fim.step = "0.1";
    fim.value = item.fim.toFixed(1);
    fim.setAttribute("aria-label", "Tempo final em segundos");

    inicio.addEventListener("change", () => {
      item.inicio = Math.max(0, Number(inicio.value) || 0);
      if (item.fim < item.inicio) item.fim = item.inicio;
      fim.value = item.fim.toFixed(1);
    });

    fim.addEventListener("change", () => {
      item.fim = Math.max(item.inicio, Number(fim.value) || 0);
      fim.value = item.fim.toFixed(1);
    });

    const labels = document.createElement("div");
    labels.className = "time-fields";

    const labelInicio = document.createElement("label");
    labelInicio.textContent = "Início (s)";
    labelInicio.appendChild(inicio);

    const labelFim = document.createElement("label");
    labelFim.textContent = "Fim (s)";
    labelFim.appendChild(fim);

    labels.append(labelInicio, labelFim);

    const ir = document.createElement("button");
    ir.className = "secondary";
    ir.textContent = "Ouvir a partir desta linha";
    ir.addEventListener("click", () => {
      audio.currentTime = item.inicio;
      seletor.value = String(item.index);
      audio.play().catch(() => {});
    });

    campos.append(labels);
    row.append(texto, campos, ir);
    lista.appendChild(row);
  });

  if (!legendas.length) {
    lista.innerHTML = '<p class="muted">Nenhuma linha criada.</p>';
  }
}

function marcarTempoAtual() {
  const valor = $("linhaSelecionada").value;

  if (valor === "") {
    mensagem("Selecione uma linha para sincronizar.");
    return;
  }

  const index = Number(valor);
  const item = legendas.find(l => l.index === index);

  if (!item) return;

  item.inicio = audio.currentTime;

  const proxima = legendas.find(l => l.index === index + 1);

  if (proxima && proxima.inicio <= item.inicio) {
    proxima.inicio = item.inicio + 2;
  }

  // O fim da linha atual será o início da próxima.
  item.fim = proxima ? Math.max(item.inicio, proxima.inicio) :
    (Number.isFinite(audio.duration) ? audio.duration : item.inicio + 4);

  if (proxima && index > 0) {
    const anterior = legendas.find(l => l.index === index - 1);
    if (anterior) anterior.fim = item.inicio;
  }

  desenharLista();

  if (proxima) {
    $("linhaSelecionada").value = String(proxima.index);
  }

  mensagem(`Início marcado em ${audio.currentTime.toFixed(2)} s.`);
}

function obterAudioGraph() {
  if (audioContext) return;

  audioContext = new AudioContext();
  sourceNode = audioContext.createMediaElementSource(audio);

  audioDestination = audioContext.createMediaStreamDestination();

  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 128;
  window._lyricAnalyser = analyser;

  sourceNode.connect(analyser);
  analyser.connect(audioContext.destination);
  analyser.connect(audioDestination);
}

async function exportarVideo() {
  if (!audio.src || !audio.duration) {
    mensagem("Importe uma música válida antes de exportar.");
    return;
  }

  if (!legendas.length) {
    mensagem("Crie as linhas da legenda antes de exportar.");
    return;
  }

  if (!window.MediaRecorder || !canvas.captureStream) {
    mensagem("Este navegador não oferece os recursos necessários para exportar.");
    return;
  }

  try {
    obterAudioGraph();
    await audioContext.resume();

    const tipos = [
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm"
    ];

    const tipo = tipos.find(t => MediaRecorder.isTypeSupported(t));

    if (!tipo) {
      mensagem("Nenhum formato de vídeo compatível foi encontrado.");
      return;
    }

    const videoStream = canvas.captureStream(30);
    const audioTracks = audioDestination.stream.getAudioTracks();

    const stream = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...audioTracks
    ]);

    chunks = [];
    recorder = new MediaRecorder(stream, {
      mimeType: tipo,
      videoBitsPerSecond: 4000000,
      audioBitsPerSecond: 192000
    });

    recorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    recorder.onerror = e => {
      mensagem("Erro durante a exportação: " +
        (e.error?.message || "erro desconhecido"));
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const extensao = recorder.mimeType.includes("mp4") ? "mp4" : "webm";

      a.href = url;
      a.download = `lyric-studio.${extensao}`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      setTimeout(() => URL.revokeObjectURL(url), 60000);

      videoStream.getTracks().forEach(t => t.stop());
      exportando = false;
      $("exportar").disabled = false;
      $("pararExportacao").disabled = true;

      mensagem(`Exportação concluída: ${extensao.toUpperCase()}.`);
    };

    audio.currentTime = 0;
    renderizarAgora();

    recorder.start(1000);
    exportando = true;

    $("exportar").disabled = true;
    $("pararExportacao").disabled = false;

    await audio.play();

    mensagem("Gravando o vídeo. Não feche esta página.");

    audio.onended = () => {
      if (exportando && recorder?.state !== "inactive") {
        recorder.stop();
      }
    };
  } catch (erro) {
    exportando = false;
    $("exportar").disabled = false;
    $("pararExportacao").disabled = true;
    mensagem("Não foi possível exportar: " + erro.message);
  }
}

$("arquivoAudio").addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;

  if (arquivoURL) URL.revokeObjectURL(arquivoURL);

  arquivoURL = URL.createObjectURL(file);
  audio.src = arquivoURL;
  $("nomeAudio").textContent = file.name;
  mensagem("Áudio carregado. Agora cole a letra.");

  audio.load();
});

audio.addEventListener("loadedmetadata", () => {
  $("duracao").textContent = fmt(audio.duration);

  if (legendas.length) {
    const duracaoAntiga = Math.max(
      ...legendas.map(l => l.fim), 0
    );

    if (duracaoAntiga > 0) {
      const fator = audio.duration / duracaoAntiga;

      legendas.forEach(l => {
        l.inicio *= fator;
        l.fim *= fator;
      });

      desenharLista();
    }
  }
});

$("playPause").addEventListener("click", async () => {
  if (!audio.src) {
    mensagem("Importe uma música primeiro.");
    return;
  }

  try {
    if (audio.paused) {
      await audio.play();
      $("playPause").textContent = "❚❚ Pausar";
    } else {
      audio.pause();
      $("playPause").textContent = "▶ Reproduzir";
    }
  } catch (erro) {
    mensagem("Não foi possível reproduzir: " + erro.message);
  }
});

audio.addEventListener("play", () => {
  $("playPause").textContent = "❚❚ Pausar";
});

audio.addEventListener("pause", () => {
  $("playPause").textContent = "▶ Reproduzir";
});

$("voltar").addEventListener("click", () => {
  audio.currentTime = Math.max(0, audio.currentTime - 5);
});

$("avancar").addEventListener("click", () => {
  audio.currentTime = Math.min(
    audio.duration || 0, audio.currentTime + 5
  );
});

$("seek").addEventListener("input", () => {
  if (audio.duration) {
    audio.currentTime = Number($("seek").value) / 100 * audio.duration;
  }
});

$("criarLinhas").addEventListener("click", criarLinhas);
$("marcarTempo").addEventListener("click", marcarTempoAtual);
$("formato").addEventListener("change", configurarFormato);

$("tamanhoTexto").addEventListener("input", () => {
  $("valorTamanho").textContent = $("tamanhoTexto").value;
});

[
  "corFundo", "corTexto", "corDestaque",
  "tamanhoTexto", "posicaoTexto", "mostrarAudio"
].forEach(id => {
  $(id).addEventListener("input", renderizarAgora);
  $(id).addEventListener("change", renderizarAgora);
});

$("exportar").addEventListener("click", exportarVideo);

$("pararExportacao").addEventListener("click", () => {
  if (recorder && recorder.state !== "inactive") {
    audio.pause();
    recorder.stop();
    audio.onended = null;
  }
});

window.addEventListener("beforeunload", () => {
  if (arquivoURL) URL.revokeObjectURL(arquivoURL);
});

renderizar();
