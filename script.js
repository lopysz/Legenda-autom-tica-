
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

const fmt = segundos => {
    if (!Number.isFinite(segundos)) return "00:00";

    const s = Math.max(0, Math.floor(segundos));

    return String(Math.floor(s / 60)).padStart(2, "0")
        + ":"
        + String(s % 60).padStart(2, "0");
};

function mensagem(texto) {
    $("mensagem").textContent = texto;
}

/* =========================================================
   SINCRONIZAÇÃO DAS LEGENDAS
========================================================= */

// Organiza os finais de cada linha com base no início
// da próxima linha, mantendo a ordem original da letra.

function recalcularFins() {
    legendas.sort((a, b) => a.index - b.index);

    legendas.forEach((item, i) => {
        const proxima = legendas[i + 1];

        if (proxima) {
            item.fim = Math.max(item.inicio, proxima.inicio);
        } else if (Number.isFinite(audio.duration) &&
                   audio.duration > item.inicio) {
            item.fim = audio.duration;
        } else {
            item.fim = Math.max(item.fim, item.inicio + 0.1);
        }
    });
}

// Quando o início de uma linha muda, todas as linhas
// seguintes acompanham a mesma diferença de tempo.

function alterarInicio(index, novoInicio) {
    const item = legendas.find(l => l.index === index);

    if (!item) return;

    novoInicio = Math.max(0, Number(novoInicio) || 0);

    const diferenca = novoInicio - item.inicio;

    if (Math.abs(diferenca) < 0.001) return;

    item.inicio = novoInicio;

    // Desloca os versos seguintes, preservando os espaços
    // entre eles e evitando sobreposição por causa do ajuste.

    legendas.forEach(l => {
        if (l.index > index) {
            l.inicio = Math.max(0, l.inicio + diferenca);
        }
    });

    recalcularFins();
    desenharLista();

    mensagem(
        "Sincronização atualizada. As linhas seguintes foram ajustadas."
    );
}

// Quando o usuário muda o fim de uma linha, o início
// da próxima linha acompanha o novo tempo. As demais
// também se deslocam para manter os intervalos.

function alterarFim(index, novoFim) {
    const item = legendas.find(l => l.index === index);

    if (!item) return;

    novoFim = Math.max(item.inicio, Number(novoFim) || 0);

    const diferenca = novoFim - item.fim;

    if (Math.abs(diferenca) < 0.001) return;

    const proxima = legendas.find(l => l.index === index + 1);

    if (proxima) {
        proxima.inicio = Math.max(0, novoFim);

        legendas.forEach(l => {
            if (l.index > proxima.index) {
                l.inicio = Math.max(0, l.inicio + diferenca);
            }
        });
    } else {
        item.fim = novoFim;
    }

    recalcularFins();
    desenharLista();

    mensagem("Fim da linha e sincronização atualizados.");
}

// Retorna a legenda que deve aparecer no instante atual.
// A decisão usa os inícios das linhas, em ordem cronológica.

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

    // Não exibe uma legenda fora do seu intervalo.
    if (t >= ativa.fim) return null;

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

    const duracao = Number.isFinite(audio.duration)
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
        "Linhas criadas. Reproduza a música e marque o início de cada verso."
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
        labelInicio.textContent = "Início (s)";

        const inicio = document.createElement("input");

        inicio.type = "number";
        inicio.min = "0";
        inicio.step = "0.1";
        inicio.value = item.inicio.toFixed(1);
        inicio.setAttribute("aria-label", "Início em segundos");

        labelInicio.appendChild(inicio);

        const labelFim = document.createElement("label");
        labelFim.textContent = "Fim (s)";

        const fim = document.createElement("input");

        fim.type = "number";
        fim.min = "0";
        fim.step = "0.1";
        fim.value = item.fim.toFixed(1);
        fim.setAttribute("aria-label", "Fim em segundos");

        labelFim.appendChild(fim);

        campos.append(labelInicio, labelFim);

        // CORREÇÃO: alterar o início recalcula os finais
        // e desloca todos os versos seguintes.

        inicio.addEventListener("change", () => {
            alterarInicio(item.index, inicio.value);
        });

        // Alterar o fim ajusta o início da próxima linha.

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

    // Usa a mesma lógica do ajuste manual.
    // Todas as linhas seguintes acompanham a diferença.

    alterarInicio(index, audio.currentTime);

    const proxima = legendas.find(l => l.index === index + 1);

    if (proxima) {
        $("linhaSelecionada").value = String(proxima.index);
    }

    mensagem(
        `Linha ${index + 1} sincronizada em ${audio.currentTime.toFixed(2)} s.`
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

// Atualizar duração e ajustar a última legenda.

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
