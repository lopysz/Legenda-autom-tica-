
"use strict";

/* =========================================================
   LYRIC STUDIO
   Áudio, legendas sincronizadas, prévia e exportação
========================================================= */

const $ = id => document.getElementById(id);

const audio = $("audio");
const canvas = $("canvas");
const ctx = canvas.getContext("2d");

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

/* =========================================================
   FORMATAÇÃO E LEITURA DOS TEMPOS
========================================================= */

// Exibição do relógio da música: 01:23
function fmt(segundos) {
    if (!Number.isFinite(segundos)) return "00:00";

    const s = Math.max(0, Math.floor(segundos));

    return String(Math.floor(s / 60)).padStart(2, "0")
        + ":"
        + String(s % 60).padStart(2, "0");
}

// Exibição dos campos de legenda: 01:23.5
function fmtTempo(segundos) {
    if (!Number.isFinite(segundos)) return "00:00.0";

    segundos = Math.max(0, segundos);

    const minutos = Math.floor(segundos / 60);
    const resto = segundos - minutos * 60;

    return String(minutos).padStart(2, "0")
        + ":"
        + resto.toFixed(1).padStart(4, "0");
}

// Converte tanto 01:23.5 quanto 83.5 em segundos.
// Também aceita vírgula decimal: 01:23,5 ou 83,5.
function lerTempo(valor) {
    if (typeof valor !== "string" && typeof valor !== "number") {
        return null;
    }

    const texto = String(valor).trim().replace(",", ".");

    if (!texto) return null;

    if (texto.includes(":")) {
        const partes = texto.split(":");

        if (partes.length !== 2) return null;

        const minutosTexto = partes[0];
        const segundosTexto = partes[1];

        if (!/^\d+$/.test(minutosTexto)) return null;
        if (!/^\d{1,2}(?:\.\d+)?$/.test(segundosTexto)) {
            return null;
        }

        const minutos = Number(minutosTexto);
        const segundos = Number(segundosTexto);

        if (!Number.isFinite(minutos) ||
            !Number.isFinite(segundos) ||
            segundos >= 60) {
            return null;
        }

        return minutos * 60 + segundos;
    }

    if (!/^\d+(?:\.\d+)?$/.test(texto)) return null;

    const segundos = Number(texto);

    return Number.isFinite(segundos) ? segundos : null;
}

function mensagem(texto) {
    $("mensagem").textContent = texto;
}

/* =========================================================
   SINCRONIZAÇÃO DAS LEGENDAS
========================================================= */

// Mantém os tempos válidos sem sobrescrever os finais
// que o usuário editou manualmente.

function recalcularFins() {
    legendas.sort((a, b) => a.index - b.index);

    const duracao = Number.isFinite(audio.duration) &&
        audio.duration > 0
        ? audio.duration
        : Infinity;

    legendas.forEach(item => {
        item.inicio = Math.max(0, Math.min(item.inicio, duracao));
        item.fim = Math.max(
            item.inicio,
            Math.min(item.fim, duracao)
        );
    });
}

// Alterar o início desloca o final da própria linha
// e os horários das linhas seguintes pela mesma diferença.

function alterarInicio(index, novoInicio) {
    const item = legendas.find(l => l.index === index);

    if (!item) return;

    const tempo = lerTempo(novoInicio);

    if (tempo === null) {
        desenharLista();
        mensagem("Tempo inválido. Use, por exemplo, 01:23.5.");
        return;
    }

    const duracao = Number.isFinite(audio.duration) &&
        audio.duration > 0
        ? audio.duration
        : Infinity;

    novoInicio = Math.max(0, Math.min(tempo, duracao));

    const diferenca = novoInicio - item.inicio;

    if (Math.abs(diferenca) < 0.001) {
        desenharLista();
        return;
    }

    item.inicio = novoInicio;
    item.fim = Math.max(item.inicio, item.fim + diferenca);

    legendas.forEach(l => {
        if (l.index > index) {
            l.inicio = Math.max(0, l.inicio + diferenca);
            l.fim = Math.max(l.inicio, l.fim + diferenca);
        }
    });

    recalcularFins();
    desenharLista();

    mensagem(
        "Início atualizado. Os horários seguintes foram ajustados."
    );
}

// Alterar o final desloca as linhas seguintes pela diferença.
// Quando as linhas eram consecutivas, o início da próxima
// acompanhará exatamente o novo final.

function alterarFim(index, novoFim) {
    const item = legendas.find(l => l.index === index);

    if (!item) return;

    const tempo = lerTempo(novoFim);

    if (tempo === null) {
        desenharLista();
        mensagem("Tempo inválido. Use, por exemplo, 01:23.5.");
        return;
    }

    const duracao = Number.isFinite(audio.duration) &&
        audio.duration > 0
        ? audio.duration
        : Infinity;

    novoFim = Math.max(
        item.inicio,
        Math.min(tempo, duracao)
    );

    const diferenca = novoFim - item.fim;

    if (Math.abs(diferenca) < 0.001) {
        desenharLista();
        return;
    }

    item.fim = novoFim;

    legendas.forEach(l => {
        if (l.index > index) {
            l.inicio = Math.max(0, l.inicio + diferenca);
            l.fim = Math.max(l.inicio, l.fim + diferenca);
        }
    });

    recalcularFins();
    desenharLista();

    mensagem(
        "Final atualizado. Os horários seguintes foram ajustados."
    );
}

// Identifica a legenda que deve aparecer no instante atual.

function linhaAtiva() {
    const t = audio.currentTime;

    const ordenadas = [...legendas].sort(
        (a, b) => a.inicio - b.inicio || a.index - b.index
    );

    let ativa = null;

    for (const item of ordenadas) {
        if (t >= item.inicio) {
            ativa = item;
        } else {
            break;
        }
    }

    if (!ativa) return null;

    if (t < ativa.inicio || t >= ativa.fim) return null;

    return ativa;
}

/* =========================================================
   DESENHO DO VÍDEO
========================================================= */

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
        ctx.fillText(
            textoLinha,
            x,
            y - total / 2 + i * altura + altura / 2
        );
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

    // Visualizador de áudio.

    if ($("mostrarAudio").checked && analyser && audioContext) {
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
                x,
                y,
                Math.max(2, largura - espacamento),
                altura
            );
        }

        ctx.globalAlpha = 1;
    }

    // Legenda atual.

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

        desenharTexto(
            atual.texto,
            w / 2,
            y,
            w * 0.84,
            tamanho
        );
    } else {
        ctx.fillStyle = corTexto;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.globalAlpha = 0.65;
        ctx.font = `bold ${Math.max(22, tamanho * 0.7)}px Arial`;
        ctx.fillText("LYRIC STUDIO", w / 2, h / 2);
        ctx.globalAlpha = 1;
    }

    // Barra de progresso.

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
            ? t / audio.duration * 100
            : 0;
    }

    atualizarLinhasAtivas();

    animacao = requestAnimationFrame(renderizar);
}

function atualizarLinhasAtivas() {
    const ativa = linhaAtiva();

    document.querySelectorAll(".lyric-row").forEach(el => {
        el.classList.toggle(
            "active",
            !!ativa && Number(el.dataset.index) === ativa.index
        );
    });

    if (ativa &&
        $("linhaSelecionada").value !== String(ativa.index)) {
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
}

/* =========================================================
   CRIAÇÃO DAS LINHAS
========================================================= */

function criarLinhas() {
    const textos = $("letra").value
        .split(/\r?\n/)
        .map(t => t.trim())
        .filter(Boolean);

    if (!textos.length) {
        mensagem("Cole a letra antes de criar as linhas.");
        return;
    }

    const duracao = Number.isFinite(audio.duration) &&
        audio.duration > 0
        ? audio.duration
        : 0;

    legendas = textos.map((texto, index) => {
        const inicio = duracao
            ? index * duracao / textos.length
            : index * 4;

        const fim = duracao
            ? (index + 1) * duracao / textos.length
            : (index + 1) * 4;

        return {
            index,
            texto,
            inicio,
            fim
        };
    });

    desenharLista();

    mensagem(
        "Linhas criadas. Edite os horários ou sincronize durante a reprodução."
    );
}

/* =========================================================
   LISTA EDITÁVEL DE LEGENDAS
========================================================= */

function desenharLista() {
    const lista = $("listaLegendas");
    const seletor = $("linhaSelecionada");

    lista.replaceChildren();
    seletor.replaceChildren();

    legendas.sort((a, b) => a.index - b.index);

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

        const labelInicio = document.createElement("label");
        labelInicio.textContent = "Início (mm:ss)";

        const inicio = document.createElement("input");

        inicio.type = "text";
        inicio.inputMode = "decimal";
        inicio.placeholder = "00:00.0";
        inicio.value = fmtTempo(item.inicio);
        inicio.setAttribute(
            "aria-label",
            "Horário de início em minutos e segundos"
        );

        labelInicio.appendChild(inicio);

        const labelFim = document.createElement("label");
        labelFim.textContent = "Fim (mm:ss)";

        const fim = document.createElement("input");

        fim.type = "text";
        fim.inputMode = "decimal";
        fim.placeholder = "00:00.0";
        fim.value = fmtTempo(item.fim);
        fim.setAttribute(
            "aria-label",
            "Horário de fim em minutos e segundos"
        );

        labelFim.appendChild(fim);

        campos.append(labelInicio, labelFim);

        inicio.addEventListener("change", () => {
            alterarInicio(item.index, inicio.value);
        });

        fim.addEventListener("change", () => {
            alterarFim(item.index, fim.value);
        });

        const ir = document.createElement("button");

        ir.className = "secondary";
        ir.textContent = "Ouvir a partir desta linha";

        ir.addEventListener("click", () => {
            audio.currentTime = item.inicio;
            seletor.value = String(item.index);

            audio.play().catch(() => {
                mensagem("Não foi possível reproduzir o áudio.");
            });
        });

        row.append(texto, campos, ir);
        lista.appendChild(row);
    });

    if (!legendas.length) {
        const vazio = document.createElement("p");

        vazio.className = "muted";
        vazio.textContent = "Nenhuma linha criada.";

        lista.appendChild(vazio);
    }

    atualizarLinhasAtivas();
}

/* =========================================================
   MARCAR O TEMPO DURANTE A REPRODUÇÃO
========================================================= */

function marcarTempoAtual() {
    const valor = $("linhaSelecionada").value;

    if (valor === "") {
        mensagem("Selecione uma linha para sincronizar.");
        return;
    }

    const index = Number(valor);
    const item = legendas.find(l => l.index === index);

    if (!item) return;

    alterarInicio(index, audio.currentTime);

    const proxima = legendas.find(l => l.index === index + 1);

    if (proxima) {
        $("linhaSelecionada").value = String(proxima.index);
    }

    mensagem(
        `Linha ${index + 1} sincronizada em ${fmtTempo(audio.currentTime)}.`
    );
}

/* =========================================================
   ÁUDIO E VISUALIZADOR
========================================================= */

function obterAudioGraph() {
    if (audioContext) return;

    audioContext = new AudioContext();

    sourceNode = audioContext.createMediaElementSource(audio);
    audioDestination = audioContext.createMediaStreamDestination();

    analyser = audioContext.createAnalyser();
    analyser.fftSize = 128;

    sourceNode.connect(analyser);

    analyser.connect(audioContext.destination);
    analyser.connect(audioDestination);
}

/* =========================================================
   EXPORTAÇÃO DO VÍDEO
========================================================= */

async function exportarVideo() {
    if (!audio.src || !Number.isFinite(audio.duration) ||
        audio.duration <= 0) {
        mensagem("Importe uma música válida antes de exportar.");
        return;
    }

    if (!legendas.length) {
        mensagem("Crie as linhas da legenda antes de exportar.");
        return;
    }

    if (!window.MediaRecorder || !canvas.captureStream) {
        mensagem(
            "Este navegador não oferece os recursos necessários para exportar."
        );
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

        const tipo = tipos.find(t =>
            MediaRecorder.isTypeSupported(t)
        );

        if (!tipo) {
            mensagem("Nenhum formato de vídeo compatível foi encontrado.");
            return;
        }

        const videoStream = canvas.captureStream(30);

        const stream = new MediaStream([
            ...videoStream.getVideoTracks(),
            ...audioDestination.stream.getAudioTracks()
        ]);

        chunks = [];

        recorder = new MediaRecorder(stream, {
            mimeType: tipo,
            videoBitsPerSecond: 4000000,
            audioBitsPerSecond: 192000
        });

        recorder.ondataavailable = e => {
            if (e.data && e.data.size > 0) {
                chunks.push(e.data);
            }
        };

        recorder.onerror = e => {
            mensagem(
                "Erro durante a exportação: " +
                (e.error?.message || "erro desconhecido")
            );
        };

        recorder.onstop = () => {
            const blob = new Blob(chunks, {
                type: recorder.mimeType
            });

            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");

            const extensao = recorder.mimeType.includes("mp4")
                ? "mp4"
                : "webm";

            a.href = url;
            a.download = `lyric-studio.${extensao}`;

            document.body.appendChild(a);
            a.click();
            a.remove();

            setTimeout(() => URL.revokeObjectURL(url), 60000);

            videoStream.getTracks().forEach(track => track.stop());

            exportando = false;

            $("exportar").disabled = false;
            $("pararExportacao").disabled = true;

            mensagem(`Exportação concluída: ${extensao.toUpperCase()}.`);
        };

        audio.currentTime = 0;

        recorder.start(1000);

        exportando = true;

        $("exportar").disabled = true;
        $("pararExportacao").disabled = false;

        audio.onended = () => {
            if (exportando && recorder?.state !== "inactive") {
                recorder.stop();
            }
        };

        await audio.play();

        mensagem(
            "Gravando o vídeo. Aguarde a música terminar sem fechar a página."
        );
    } catch (erro) {
        exportando = false;

        $("exportar").disabled = false;
        $("pararExportacao").disabled = true;

        mensagem("Não foi possível exportar: " + erro.message);
    }
}

/* =========================================================
   EVENTOS
========================================================= */

// Importar áudio.

$("arquivoAudio").addEventListener("change", e => {
    const file = e.target.files[0];

    if (!file) return;

    if (arquivoURL) {
        URL.revokeObjectURL(arquivoURL);
    }

    arquivoURL = URL.createObjectURL(file);

    audio.src = arquivoURL;
    $("nomeAudio").textContent = file.name;

    mensagem("Áudio carregado. Agora cole a letra.");

    audio.load();
});

// Atualizar duração e validar os tempos quando o áudio carregar.

audio.addEventListener("loadedmetadata", () => {
    $("duracao").textContent = fmt(audio.duration);

    if (legendas.length) {
        recalcularFins();
        desenharLista();
    }
});

// Reprodução e pausa.

$("playPause").addEventListener("click", async () => {
    if (!audio.src) {
        mensagem("Importe uma música primeiro.");
        return;
    }

    try {
        if (audio.paused) {
            await audio.play();
        } else {
            audio.pause();
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
        audio.duration || 0,
        audio.currentTime + 5
    );
});

// Navegar pela música.

$("seek").addEventListener("input", () => {
    if (audio.duration) {
        audio.currentTime =
            Number($("seek").value) / 100 * audio.duration;
    }
});

// Legendas.

$("criarLinhas").addEventListener("click", criarLinhas);

$("marcarTempo").addEventListener("click", marcarTempoAtual);

// Formato do vídeo.

$("formato").addEventListener("change", configurarFormato);

// Personalização.

$("tamanhoTexto").addEventListener("input", () => {
    $("valorTamanho").textContent = $("tamanhoTexto").value;
});

// Exportação.

$("exportar").addEventListener("click", exportarVideo);

$("pararExportacao").addEventListener("click", () => {
    if (recorder && recorder.state !== "inactive") {
        audio.pause();
        audio.onended = null;
        recorder.stop();
    }
});

// Limpeza ao sair.

window.addEventListener("beforeunload", () => {
    if (arquivoURL) {
        URL.revokeObjectURL(arquivoURL);
    }

    if (animacao) {
        cancelAnimationFrame(animacao);
    }
});

// Inicialização.

configurarFormato();
renderizar();
