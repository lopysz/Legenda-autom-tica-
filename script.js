(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const audio = $("audio");
  const canvas = $("previewCanvas");
  const ctx = canvas.getContext("2d");
  let subtitles = [];
  let backgroundImage = null;
  let animationFrame = null;
  let mediaRecorder = null;
  let recordingChunks = [];
  let audioContext = null;
  let audioSource = null;
  let audioDestination = null;
  let exportStream = null;
  let exportStartedAt = 0;

  const state = { currentSection: "editor", objectUrl: null, backgroundUrl: null };

  function setStatus(text) { $("statusGeral").textContent = text; }

  function formatClock(seconds, decimals = true) {
    const safe = Math.max(0, Number(seconds) || 0);
    const m = Math.floor(safe / 60);
    const s = safe % 60;
    return String(m).padStart(2, "0") + ":" + (decimals ? s.toFixed(1).padStart(4, "0") : String(Math.floor(s)).padStart(2, "0"));
  }

  function parseTimestamp(raw) {
    const value = String(raw || "").trim().replace(",", ".");
    const p = value.split(":");
    if (p.length !== 2 && p.length !== 3) return NaN;
    const n = p.map(Number);
    if (n.some(x => !Number.isFinite(x))) return NaN;
    if (p.length === 3) return n[0] * 3600 + n[1] * 60 + n[2];
    return n[0] * 60 + n[1];
  }

  function timestampToSrt(seconds) {
    const ms = Math.max(0, Math.round(seconds * 1000));
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const milli = ms % 1000;
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")},${String(milli).padStart(3,"0")}`;
  }

  function timestampToVtt(seconds) {
    return timestampToSrt(seconds).replace(",", ".");
  }

  function parseSubtitleFile(content) {
    const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
    const blocks = normalized.split(/\n\s*\n/);
    const result = [];

    for (const block of blocks) {
      const lines = block.split("\n");
      const timeIndex = lines.findIndex(line => line.includes("-->"));
      if (timeIndex < 0) continue;

      const timing = lines[timeIndex].split("-->");
      if (timing.length < 2) continue;
      const startRaw = timing[0].trim();
      const endRaw = timing[1].trim().split(/\s+/)[0];
      const start = parseTimestamp(startRaw);
      const end = parseTimestamp(endRaw);
      const text = lines.slice(timeIndex + 1).join(" ")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<\/?[^>]+>/g, "")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
        .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
        .trim();

      if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && text) {
        result.push({ id: cryptoId(), text, start, end });
      }
    }
    return result.sort((a, b) => a.start - b.start);
  }

  function cryptoId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function importSubtitles() {
    const file = $("subtitleFile").files[0];
    if (!file) {
      $("importStatus").textContent = "Selecione primeiro um arquivo .srt ou .vtt.";
      return;
    }
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["srt", "vtt"].includes(ext)) {
      $("importStatus").textContent = "Formato não reconhecido. Use .srt ou .vtt.";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseSubtitleFile(String(reader.result || ""));
        if (!parsed.length) {
          $("importStatus").textContent = "Não encontrei blocos válidos com texto e horários. Verifique o arquivo.";
          return;
        }
        subtitles = parsed;
        renderSubtitleTable();
        $("manualLyrics").value = subtitles.map(x => x.text).join("\n");
        $("importStatus").textContent = `${subtitles.length} trechos importados. Os tempos originais foram preservados.`;
        setStatus("Legendas importadas");
        drawPreview();
      } catch (error) {
        console.error(error);
        $("importStatus").textContent = "Não foi possível interpretar esse arquivo.";
      }
    };
    reader.onerror = () => $("importStatus").textContent = "Falha ao ler o arquivo selecionado.";
    reader.readAsText(file, "UTF-8");
  }

  function createManualSubtitles() {
    const lines = $("manualLyrics").value.split(/\n/).map(s => s.trim()).filter(Boolean);
    if (!lines.length) {
      $("importStatus").textContent = "Cole a letra antes de criar as legendas.";
      return;
    }
    subtitles = lines.map((text, i) => ({
      id: cryptoId(), text,
      start: i * 3,
      end: i * 3 + 2.8
    }));
    renderSubtitleTable();
    $("importStatus").textContent = `${subtitles.length} trechos criados. Ajuste os tempos na tabela para sincronizar com a música.`;
    setStatus("Legendas criadas");
    drawPreview();
  }

  function renderSubtitleTable() {
    const tbody = $("subtitleTable");
    tbody.replaceChildren();
    $("subtitleCount").textContent = `${subtitles.length} ${subtitles.length === 1 ? "trecho" : "trechos"}`;
    if (!subtitles.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 5;
      td.className = "empty-cell";
      td.textContent = "Importe um arquivo SRT/VTT ou crie legendas manualmente.";
      tr.append(td); tbody.append(tr); return;
    }

    subtitles.forEach((sub, index) => {
      const tr = document.createElement("tr");
      const number = document.createElement("td"); number.textContent = String(index + 1); tr.append(number);

      const textCell = document.createElement("td");
      const textInput = document.createElement("input");
      textInput.type = "text"; textInput.value = sub.text; textInput.setAttribute("aria-label", `Texto da legenda ${index + 1}`);
      textInput.addEventListener("change", () => { sub.text = textInput.value.trim(); drawPreview(); });
      textCell.append(textInput); tr.append(textCell);

      tr.append(makeNumberCell(sub, "start", index, "Início"));
      tr.append(makeNumberCell(sub, "end", index, "Fim"));

      const action = document.createElement("td");
      const remove = document.createElement("button");
      remove.type = "button"; remove.className = "btn danger"; remove.textContent = "Excluir";
      remove.addEventListener("click", () => { subtitles.splice(index, 1); renderSubtitleTable(); drawPreview(); });
      action.append(remove); tr.append(action);
      tbody.append(tr);
    });
  }

  function makeNumberCell(sub, key, index, label) {
    const td = document.createElement("td");
    const input = document.createElement("input");
    input.type = "number"; input.min = "0"; input.step = "0.01"; input.value = Number(sub[key]).toFixed(2);
    input.setAttribute("aria-label", `${label} da legenda ${index + 1}`);
    input.addEventListener("change", () => {
      const value = Number(input.value);
      if (!Number.isFinite(value) || value < 0) {
        input.value = Number(sub[key]).toFixed(2); return;
      }
      sub[key] = value;
      if (sub.end <= sub.start) {
        if (key === "start") sub.end = sub.start + 0.5;
        else sub.start = Math.max(0, sub.end - 0.5);
      }
      subtitles.sort((a, b) => a.start - b.start);
      renderSubtitleTable();
      drawPreview();
    });
    td.append(input); return td;
  }

  function activeSubtitle(time) {
    // Último trecho iniciado que ainda não chegou ao seu fim.
    for (let i = subtitles.length - 1; i >= 0; i--) {
      const s = subtitles[i];
      if (time >= s.start && time <= s.end) return s;
    }
    return null;
  }

  function wrapText(text, maxWidth, font) {
    ctx.font = font;
    const words = String(text || "").split(/\s+/);
    const lines = [];
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line); line = word;
      } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawPreview(time = audio.currentTime || 0) {
    const format = $("videoFormat").value;
    const dimensions = format === "horizontal" ? [1280, 720] : format === "square" ? [900, 900] : [720, 1280];
    if (canvas.width !== dimensions[0] || canvas.height !== dimensions[1]) {
      canvas.width = dimensions[0]; canvas.height = dimensions[1];
    }
    const w = canvas.width, h = canvas.height;
    const bg = $("backgroundStyle").value;
    if (bg === "image" && backgroundImage) {
      const scale = Math.max(w / backgroundImage.width, h / backgroundImage.height);
      const dw = backgroundImage.width * scale, dh = backgroundImage.height * scale;
      ctx.drawImage(backgroundImage, (w - dw) / 2, (h - dh) / 2, dw, dh);
      ctx.fillStyle = "rgba(0,0,0,.38)"; ctx.fillRect(0, 0, w, h);
    } else if (bg === "black") {
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
    } else {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, "#101a15"); grad.addColorStop(.55, "#1e3529"); grad.addColorStop(1, "#080b09");
      ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = .12;
      for (let i = 0; i < 7; i++) {
        ctx.beginPath(); ctx.arc((i * 173 + 70) % w, (i * 271 + 90) % h, 55 + (i % 3) * 30, 0, Math.PI * 2);
        ctx.fillStyle = "#8be4af"; ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    const active = activeSubtitle(time);
    if (!active) {
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,.55)";
      ctx.font = `600 ${Math.max(20, Number($("fontSize").value) * .65)}px system-ui, sans-serif`;
      ctx.fillText(subtitles.length ? "♪" : "Seu vídeo aparecerá aqui", w / 2, h / 2, w * .82);
      return;
    }

    const size = Number($("fontSize").value) * (w / 720);
    const font = `700 ${size}px system-ui, sans-serif`;
    const maxWidth = w * .82;
    const lines = wrapText(active.text, maxWidth, font);
    const lineHeight = size * 1.28;
    const blockHeight = lines.length * lineHeight;
    let y;
    if ($("textPosition").value === "top") y = h * .2;
    else if ($("textPosition").value === "bottom") y = h * .78 - blockHeight / 2;
    else y = h / 2 - blockHeight / 2;
    ctx.font = font; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    lines.forEach((line, i) => {
      const yy = y + i * lineHeight + lineHeight / 2;
      ctx.lineWidth = Math.max(3, size * .13);
      ctx.strokeStyle = "rgba(0,0,0,.8)";
      ctx.lineJoin = "round";
      ctx.strokeText(line, w / 2, yy, maxWidth);
      ctx.fillStyle = $("textColor").value;
      ctx.fillText(line, w / 2, yy, maxWidth);
    });
    // Pequeno traço de destaque para identidade visual.
    ctx.fillStyle = $("highlightColor").value;
    ctx.fillRect(w * .42, Math.min(h - 22, y + blockHeight + 20), w * .16, Math.max(3, w * .005));
  }

  function drawLoop() {
    drawPreview();
    updatePlayerUI();
    if (!audio.paused && !audio.ended) animationFrame = requestAnimationFrame(drawLoop);
    else animationFrame = null;
  }

  function updatePlayerUI() {
    const now = audio.currentTime || 0;
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    $("currentTime").textContent = formatClock(now);
    $("duration").textContent = formatClock(duration);
    $("seekBar").max = duration || 100;
    $("seekBar").value = Math.min(now, duration || 100);
  }

  function togglePlayback() {
    if (!audio.src) {
      $("importStatus").textContent = "Selecione um arquivo de áudio primeiro.";
      return;
    }
    if (audio.paused) {
      audio.play().catch(err => {
        console.warn(err);
        $("importStatus").textContent = "O navegador não conseguiu reproduzir esse áudio.";
      });
    } else audio.pause();
  }

  function clearSubtitles() {
    subtitles = [];
    renderSubtitleTable();
    $("manualLyrics").value = "";
    $("importStatus").textContent = "Legendas removidas.";
    drawPreview();
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function exportSubtitle(format) {
    if (!subtitles.length) {
      $("importStatus").textContent = "Não há legendas para exportar."; return;
    }
    const sorted = [...subtitles].sort((a, b) => a.start - b.start);
    let content;
    if (format === "srt") {
      content = sorted.map((s, i) => `${i + 1}\n${timestampToSrt(s.start)} --> ${timestampToSrt(s.end)}\n${s.text}`).join("\n\n") + "\n";
      downloadBlob(new Blob([content], { type: "application/x-subrip;charset=utf-8" }), "legendas.srt");
    } else {
      content = "WEBVTT\n\n" + sorted.map(s => `${timestampToVtt(s.start)} --> ${timestampToVtt(s.end)}\n${s.text}`).join("\n\n") + "\n";
      downloadBlob(new Blob([content], { type: "text/vtt;charset=utf-8" }), "legendas.vtt");
    }
  }

  function supportedRecorderMime() {
    if (!window.MediaRecorder) return "";
    const types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    return types.find(t => MediaRecorder.isTypeSupported(t)) || "";
  }

  async function exportVideo() {
    if (!audio.src) {
      $("exportStatus").textContent = "Selecione um arquivo de áudio antes de exportar."; return;
    }
    if (!subtitles.length) {
      $("exportStatus").textContent = "Importe ou crie legendas antes de exportar."; return;
    }
    if (!canvas.captureStream || !window.MediaRecorder) {
      $("exportStatus").textContent = "Este navegador não suporta gravação de vídeo. Tente usar Chrome ou Edge atualizado.";
      return;
    }
    const mimeType = supportedRecorderMime();
    if (!mimeType) {
      $("exportStatus").textContent = "Este navegador não oferece um formato WebM compatível para gravação.";
      return;
    }

    try {
      // Cria uma única ligação do áudio para a gravação e para os alto-falantes.
      if (!audioContext) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioContextClass();
        audioSource = audioContext.createMediaElementSource(audio);
        audioDestination = audioContext.createMediaStreamDestination();
        audioSource.connect(audioDestination);
        audioSource.connect(audioContext.destination);
      }
      await audioContext.resume();

      const canvasStream = canvas.captureStream(30);
      exportStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audioDestination.stream.getAudioTracks()
      ]);
      recordingChunks = [];
      mediaRecorder = new MediaRecorder(exportStream, { mimeType });
      mediaRecorder.ondataavailable = event => {
        if (event.data && event.data.size) recordingChunks.push(event.data);
      };
      mediaRecorder.onerror = event => {
        console.error(event);
        $("exportStatus").textContent = "O navegador encontrou um erro durante a gravação.";
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordingChunks, { type: mimeType });
        if (blob.size) downloadBlob(blob, "lyric-studio.webm");
        $("exportStatus").textContent = blob.size
          ? "Exportação concluída. O arquivo lyric-studio.webm foi baixado."
          : "A gravação ficou vazia. Tente novamente em um navegador compatível.";
        $("exportVideo").classList.remove("hidden");
        $("stopExport").classList.add("hidden");
        if (exportStream) exportStream.getTracks().forEach(track => track.stop());
        exportStream = null;
      };

      mediaRecorder.start(1000);
      $("exportVideo").classList.add("hidden");
      $("stopExport").classList.remove("hidden");
      $("exportStatus").textContent = "Gravando a prévia. A gravação termina quando o áudio acabar.";
      setStatus("Exportando vídeo");

      audio.currentTime = 0;
      await audio.play();
      exportStartedAt = Date.now();
      if (!animationFrame) drawLoop();
    } catch (error) {
      console.error(error);
      $("exportStatus").textContent = "Não foi possível iniciar a exportação. Tente tocar a música primeiro e exportar novamente.";
      $("exportVideo").classList.remove("hidden");
      $("stopExport").classList.add("hidden");
      if (exportStream) exportStream.getTracks().forEach(track => track.stop());
    }
  }

  function stopExport() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
    audio.pause();
    $("stopExport").classList.add("hidden");
    $("exportVideo").classList.remove("hidden");
  }

  function loadAudio() {
    const file = $("audioFile").files[0];
    if (!file) return;
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = URL.createObjectURL(file);
    audio.src = state.objectUrl;
    $("audioName").textContent = file.name;
    $("exportStatus").textContent = "Áudio carregado. Importe as legendas e exporte quando estiver pronto.";
    setStatus("Áudio carregado");
    audio.load();
  }

  function loadBackgroundImage() {
    const file = $("backgroundImage").files[0];
    if (!file) { backgroundImage = null; drawPreview(); return; }
    if (state.backgroundUrl) URL.revokeObjectURL(state.backgroundUrl);
    state.backgroundUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { backgroundImage = img; $("backgroundStyle").value = "image"; drawPreview(); };
    img.onerror = () => { backgroundImage = null; $("importStatus").textContent = "Não foi possível carregar a imagem de fundo."; };
    img.src = state.backgroundUrl;
  }

  $("importSubtitles").addEventListener("click", importSubtitles);
  $("clearSubtitles").addEventListener("click", clearSubtitles);
  $("createManual").addEventListener("click", createManualSubtitles);
  $("audioFile").addEventListener("change", loadAudio);
  $("playPreview").addEventListener("click", togglePlayback);
  $("seekBar").addEventListener("input", () => {
    if (Number.isFinite(audio.duration)) audio.currentTime = Number($("seekBar").value);
    drawPreview();
  });
  $("exportVideo").addEventListener("click", exportVideo);
  $("stopExport").addEventListener("click", stopExport);
  $("downloadSrt").addEventListener("click", () => exportSubtitle("srt"));
  $("downloadVtt").addEventListener("click", () => exportSubtitle("vtt"));
  $("backgroundImage").addEventListener("change", loadBackgroundImage);
  ["videoFormat", "backgroundStyle", "textColor", "highlightColor", "fontSize", "textPosition"].forEach(id => {
    $(id).addEventListener("input", () => {
      if (id === "fontSize") $("fontSizeValue").textContent = `${$("fontSize").value} px`;
      drawPreview();
    });
    $(id).addEventListener("change", drawPreview);
  });
  audio.addEventListener("loadedmetadata", updatePlayerUI);
  audio.addEventListener("timeupdate", () => { drawPreview(); updatePlayerUI(); });
  audio.addEventListener("play", () => {
    $("playPreview").textContent = "Ⅱ Pausar";
    if (!animationFrame) drawLoop();
  });
  audio.addEventListener("pause", () => {
    $("playPreview").textContent = "▶ Reproduzir";
    drawPreview(); updatePlayerUI();
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = null;
  });
  audio.addEventListener("ended", () => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  });
  document.querySelectorAll(".nav-item").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
      button.classList.add("active");
      const section = button.dataset.section;
      if (section === "legendas") $("section-legendas").scrollIntoView({ behavior: "smooth", block: "start" });
      else $("section-editor").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  renderSubtitleTable();
  drawPreview();
})();
