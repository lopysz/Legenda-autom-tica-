/* script.js - Versão mínima funcional com Timeline e popup integrado
   Substitua o script.js antigo por este. Mantive as funções essenciais.
*/

/* -----------------------
   Helpers e estado
   ----------------------- */
const $ = id => document.getElementById(id);

function mensagem(texto) {
  const el = $("mensagem");
  if (el) el.textContent = texto;
  else console.log("mensagem:", texto);
}

function formatarTempo(segundos) {
  if (!isFinite(segundos) || segundos < 0) return "00:00";
  const s = Math.floor(segundos % 60).toString().padStart(2, "0");
  const m = Math.floor(segundos / 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function limitar(valor, minimo, maximo) {
  return Math.max(minimo, Math.min(maximo, valor));
}

const audio = $("audio");
const canvas = $("canvas");
const ctx = canvas ? canvas.getContext("2d") : null;

let legendas = []; // {id,text,start,end}
let indiceSelecionado = -1;

/* -----------------------
   Controles de áudio
   ----------------------- */
const arquivoAudio = $("arquivoAudio");
const nomeAudio = $("nomeAudio");
const playPause = $("playPause");
const voltarBtn = $("voltar");
const avancarBtn = $("avancar");
const tempoAtualEl = $("tempoAtual");
const duracaoEl = $("duracao");
const seek = $("seek");

if (arquivoAudio) {
  arquivoAudio.addEventListener("change", (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) {
      nomeAudio.textContent = "Nenhum áudio selecionado";
      audio.removeAttribute("src");
      audio.load();
      return;
    }
    const url = URL.createObjectURL(f);
    audio.src = url;
    nomeAudio.textContent = f.name;
    audio.load();
    audio.onloadedmetadata = () => {
      duracaoEl.textContent = formatarTempo(audio.duration);
      seek.max = 100;
    };
  });
}

if (playPause) {
  playPause.addEventListener("click", () => {
    if (!audio.src) {
      mensagem("Importe um áudio primeiro.");
      return;
    }
    if (audio.paused) {
      audio.play();
      playPause.textContent = "Ⅱ";
    } else {
      audio.pause();
      playPause.textContent = "▶";
    }
  });
}

if (voltarBtn) voltarBtn.addEventListener("click", () => {
  if (!audio.src) return;
  audio.currentTime = Math.max(0, audio.currentTime - 5);
});

if (avancarBtn) avancarBtn.addEventListener("click", () => {
  if (!audio.src) return;
  audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
});

audio.addEventListener("timeupdate", () => {
  tempoAtualEl.textContent = formatarTempo(audio.currentTime || 0);
  const dur = audio.duration || 0;
  if (dur > 0) {
    const pct = (audio.currentTime / dur) * 100;
    seek.value = pct;
  }
});

seek.addEventListener("input", (e) => {
  const dur = audio.duration || 0;
  const pct = Number(e.target.value);
  if (dur > 0) audio.currentTime = (pct / 100) * dur;
});

/* -----------------------
   Criar linhas / lista
   ----------------------- */
const criarLinhasBtn = $("criarLinhas");
const letraArea = $("letra");
const listaLegendas = $("listaLegendas");
const contadorLegendas = $("contadorLegendas");
const linhaSelecionadaSelect = $("linhaSelecionada");
const marcarInicioBtn = $("marcarInicio");
const marcarTempoBtn = $("marcarTempo");

function atualizarContador() {
  contadorLegendas.textContent = `${legendas.length} legenda${legendas.length !== 1 ? 's' : ''}`;
}

function atualizarSeletorLegendas() {
  if (!linhaSelecionadaSelect) return;
  linhaSelecionadaSelect.innerHTML = `<option value="">Nenhuma legenda</option>` +
    legendas.map((l, i) => `<option value="${i}">${i+1}. ${l.text.slice(0,40)}</option>`).join('');
}

function desenharListaLegendas() {
  listaLegendas.innerHTML = '';
  if (legendas.length === 0) {
    listaLegendas.innerHTML = '<div class="empty-state">Suas legendas aparecerão aqui.</div>';
    return;
  }
  for (let i = 0; i < legendas.length; i++) {
    const lg = legendas[i];
    const el = document.createElement('div');
    el.className = 'legenda-item';
    el.dataset.index = i;
    el.innerHTML = `
      <div class="tempos">
        <label>Início: <input type="text" data-start value="${lg.start != null ? formatarTempo(lg.start) : ''}" readonly></label>
        <label>Fim: <input type="text" data-end value="${lg.end != null ? formatarTempo(lg.end) : ''}" readonly></label>
      </div>
      <div class="texto-legenda">${escapeHtml(lg.text)}</div>
      <div class="acoes">
        <button class="btn selecionar">Selecionar</button>
        <button class="btn danger apagar">Apagar</button>
      </div>
    `;
    // selecionar
    el.querySelector('.selecionar').addEventListener('click', () => {
      indiceSelecionado = i;
      atualizarSeletorLegendas();
      linhaSelecionadaSelect.value = String(i);
      el.scrollIntoView({behavior:'smooth', block:'center'});
    });
    // apagar
    el.querySelector('.apagar').addEventListener('click', () => {
      legendas.splice(i,1);
      desenharListaLegendas();
      atualizarContador();
      atualizarSeletorLegendas();
    });
    listaLegendas.appendChild(el);
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

if (criarLinhasBtn) {
  criarLinhasBtn.addEventListener('click', () => {
    const text = letraArea.value || '';
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    legendas = lines.map((t,i) => ({ id: 'l'+i, text: t, start: null, end: null }));
    desenharListaLegendas();
    atualizarContador();
    atualizarSeletorLegendas();
    mensagem(`${legendas.length} linhas criadas.`);
  });
}

/* marcar inicio/fim */
if (marcarInicioBtn) {
  marcarInicioBtn.addEventListener('click', () => {
    const idx = Number(linhaSelecionadaSelect.value);
    if (!Number.isFinite(idx) || idx < 0 || !legendas[idx]) {
      mensagem("Selecione uma legenda primeiro.");
      return;
    }
    const t = audio.currentTime || 0;
    legendas[idx].start = Number(t.toFixed(2));
    // atualizar UI
    desenharListaLegendas();
    mensagem(`Início da legenda ${idx+1} definido em ${formatarTempo(t)}.`);
  });
}

if (marcarTempoBtn) {
  marcarTempoBtn.addEventListener('click', () => {
    const idx = Number(linhaSelecionadaSelect.value);
    if (!Number.isFinite(idx) || idx < 0 || !legendas[idx]) {
      mensagem("Selecione uma legenda primeiro.");
      return;
    }
    const t = audio.currentTime || 0;
    legendas[idx].end = Number(t.toFixed(2));
    desenharListaLegendas();
    mensagem(`Fim da legenda ${idx+1} definido em ${formatarTempo(t)}.`);
  });
}

/* -----------------------
   Timeline overlay (preview+pool+drag drop)
   ----------------------- */
(function timelineFeature() {
  const overlay = $("timelineOverlay");
  const pool = $("timelinePool");
  const drop = $("timelineDropArea");
  const closeBtn = $("closeTimeline");
  const saveBtn = $("saveTimeline");
  const cancelBtn = $("cancelTimeline");
  const previewWrap = document.querySelector('.timeline-preview-wrap');

  // guarda onde colocar de volta
  let originalCanvasParent = null;
  let originalAudioParent = null;

  function obterDuracaoSafe() {
    return (audio && audio.duration && isFinite(audio.duration)) ? audio.duration : 0;
  }

  function moveIntoPreview(node) {
    if (!node) return;
    // se já movido, não duplicar
    if (!originalCanvasParent && node === canvas) {
      originalCanvasParent = node.parentNode;
    }
    if (node === audio && !originalAudioParent) {
      originalAudioParent = node.parentNode;
    }
    previewWrap.innerHTML = '';
    previewWrap.appendChild(node);
  }

  function restoreOriginals() {
    if (originalCanvasParent && canvas && !originalCanvasParent.contains(canvas)) {
      originalCanvasParent.appendChild(canvas);
      originalCanvasParent = null;
    }
    if (originalAudioParent && audio && !originalAudioParent.contains(audio)) {
      originalAudioParent.appendChild(audio);
      originalAudioParent = null;
    }
    if (audio) audio.controls = false;
  }

  window.openTimeline = function(lines = [], estimatedTimes = []) {
    // if lines empty, build from legendas[]
    let items = lines && lines.length ? lines : legendas.slice();
    pool.innerHTML = '';
    const duration = obterDuracaoSafe() || 60;

    if (!audio || !audio.src) {
      // allow open but notify
      console.info("Nenhum áudio carregado.");
    }

    moveIntoPreview(canvas);
    if (audio) {
      audio.controls = true;
      moveIntoPreview(audio);
    }

    if (!items || items.length === 0) {
      pool.innerHTML = '<div class="empty-state">Nenhuma linha detectada. Crie legendas ou cole a letra.</div>';
    } else {
      items.forEach((it, i) => {
        const text = (it.text || it).toString();
        const est = estimatedTimes?.[i] ?? ( (it.start != null) ? it.start : Math.max(0, (i / items.length) * duration) );
        const estEnd = (it.end != null) ? it.end : Math.min(duration, est + 3);
        const div = document.createElement('div');
        div.className = 'pool-item';
        div.draggable = true;
        div.dataset.id = it.id ?? ('l' + i);
        div.dataset.text = text;
        div.dataset.start = est;
        div.dataset.end = estEnd;
        div.innerHTML = `<div class="times">${formatarTempo(est)} — ${formatarTempo(estEnd)}</div><div class="text">${escapeHtml(text)}</div>`;
        div.addEventListener('dragstart', (ev) => {
          ev.dataTransfer.setData('text/plain', JSON.stringify({ id: div.dataset.id, text, start: est, end: estEnd }));
          ev.dataTransfer.effectAllowed = 'copy';
        });
        pool.appendChild(div);
      });
    }

    drop.innerHTML = '';
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
  };

  function closeOverlay() {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    restoreOriginals();
  }

  closeBtn?.addEventListener('click', closeOverlay);
  cancelBtn?.addEventListener('click', closeOverlay);

  saveBtn?.addEventListener('click', () => {
    // pega clipes e aplica nas legendas (simples)
    const clips = Array.from(drop.querySelectorAll('.timeline-clip')).map(el => ({
      id: el.dataset.id,
      text: el.dataset.text,
      start: Number(el.dataset.start),
      end: Number(el.dataset.end)
    }));
    // Mapear clips para legendas: se id bate atualiza start/end, senão cria nova legenda
    clips.forEach(c => {
      const idx = legendas.findIndex(l => l.id === c.id);
      if (idx >= 0) {
        legendas[idx].start = Number(c.start.toFixed(2));
        legendas[idx].end = Number(c.end.toFixed(2));
      } else {
        // cria uma nova
        legendas.push({ id: c.id || ('l'+legendas.length), text: c.text, start: Number(c.start.toFixed(2)), end: Number(c.end.toFixed(2)) });
      }
    });
    desenharListaLegendas();
    atualizarContador();
    atualizarSeletorLegendas();
    closeOverlay();
    mensagem('Legendas atualizadas a partir da timeline.');
  });

  // Drop handlers
  drop.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
  });

  drop.addEventListener('drop', (ev) => {
    ev.preventDefault();
    const data = ev.dataTransfer.getData('text/plain');
    if (!data) return;
    const obj = JSON.parse(data);
    const rect = drop.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    const duration = obterDuracaoSafe() || 60;
    const start = pct * duration;
    const defaultDur = Math.min(6, duration * 0.05) || 3;
    createClipOnTimeline(obj.id, obj.text, start, Math.min(duration, start + defaultDur));
  });

  function createClipOnTimeline(id, text, start, end) {
    const rect = drop.getBoundingClientRect();
    const duration = obterDuracaoSafe() || 60;
    const leftPct = (start / duration) * 100;
    const widthPct = ((end - start) / duration) * 100;
    const clip = document.createElement('div');
    clip.className = 'timeline-clip';
    clip.style.left = `${leftPct}%`;
    clip.style.width = `${Math.max(2, widthPct)}%`;
    clip.dataset.id = id ?? ('c' + Date.now());
    clip.dataset.text = text;
    clip.dataset.start = start;
    clip.dataset.end = end;
    clip.innerHTML = `<div class="label">${escapeHtml(text)}</div><div class="times-mini">${formatarTempo(start)}</div>`;

    // drag to move
    let dragging = null;
    clip.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      dragging = { startX: ev.clientX, origLeft: parseFloat(clip.style.left || 0) };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });

    function onMove(ev) {
      if (!dragging) return;
      const dx = ev.clientX - dragging.startX;
      const pctDelta = (dx / rect.width) * 100;
      let newLeft = dragging.origLeft + pctDelta;
      newLeft = Math.max(0, Math.min(100 - parseFloat(clip.style.width || 0), newLeft));
      clip.style.left = newLeft + '%';
      const newStart = (newLeft / 100) * duration;
      const width = parseFloat(clip.style.width);
      const newEnd = newStart + (width / 100) * duration;
      clip.dataset.start = newStart;
      clip.dataset.end = newEnd;
      const tMini = clip.querySelector('.times-mini');
      if (tMini) tMini.textContent = formatarTempo(newStart);
    }

    function onUp() {
      dragging = null;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    }

    drop.appendChild(clip);
  }

  // connect topbar button if exists
  document.getElementById('btnOpenTimeline')?.addEventListener('click', () => {
    const texto = (document.getElementById('letra')?.value || '').trim();
    const lines = texto ? texto.split('\n').map((t,i) => ({ id: 'l'+i, text: t.trim() })) : legendas.slice();
    window.openTimeline(lines, []);
  });

})();

/* -----------------------
   Popups flutuantes (abrir panel-section como modal)
   ----------------------- */
(function popupFloating() {
  function initFloating() {
    const bd = document.getElementById("floatingBackdrop");
    const ht = document.getElementById("floatingHost");
    if (!bd || !ht) return;

    let abertoState = { secao: null, originalParent: null, originalNext: null, wrapper: null };

    function restaurarSecao() {
      const s = abertoState.secao;
      const p = abertoState.originalParent;
      const next = abertoState.originalNext;
      const wrapper = abertoState.wrapper;
      if (!s) return;
      if (wrapper && p) {
        try { p.insertBefore(s, next); } catch (e) { if (p && p.appendChild) p.appendChild(s); }
      }
      abertoState = { secao: null, originalParent: null, originalNext: null, wrapper: null };
      bd.classList.remove('visible');
    }

    function fecharPainel() {
      const wrapper = abertoState.wrapper;
      if (!wrapper) return;
      wrapper.classList.remove("open");
      bd.classList.remove("visible");
      restaurarSecao();
      setTimeout(() => { if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper); }, 200);
      document.body.style.overflow = "";
      bd.onclick = null;
    }

    function abrirPainel(secao) {
      if (!secao) return;
      if (abertoState.wrapper) fecharPainel();
      abertoState.secao = secao;
      abertoState.originalParent = secao.parentNode;
      abertoState.originalNext = secao.nextSibling;

      const wrapper = document.createElement("div");
      wrapper.className = "floating-panel";
      wrapper.setAttribute("role", "dialog");
      wrapper.setAttribute("aria-modal", "true");

      const header = document.createElement("div");
      header.className = "floating-panel-header";

      const tituloEl = document.createElement("h3");
      tituloEl.textContent = secao.querySelector(".section-title h2")?.textContent || "Configuração";

      const fecharBtn = document.createElement("button");
      fecharBtn.type = "button";
      fecharBtn.className = "floating-panel-close";
      fecharBtn.setAttribute("aria-label", "Fechar painel");
      fecharBtn.textContent = "×";
      fecharBtn.addEventListener("click", () => fecharPainel());

      header.appendChild(tituloEl);
      header.appendChild(fecharBtn);

      const body = document.createElement("div");
      body.className = "floating-panel-body";

      body.appendChild(secao);

      wrapper.appendChild(header);
      wrapper.appendChild(body);

      wrapper.__lastFocus = document.activeElement;

      ht.appendChild(wrapper);
      abertoState.wrapper = wrapper;

      requestAnimationFrame(() => {
        wrapper.classList.add("open");
        bd.classList.add("visible");
      });

      document.body.style.overflow = "hidden";

      bd.onclick = (ev) => { if (ev.target === bd) fecharPainel(); };

      const onKey = (ev) => {
        if (ev.key === "Escape") { fecharPainel(); document.removeEventListener("keydown", onKey); }
      };
      document.addEventListener("keydown", onKey);

      setTimeout(() => {
        const primeiro = wrapper.querySelector("input, button, textarea, select, summary");
        if (primeiro && typeof primeiro.focus === "function") primeiro.focus();
      }, 80);
    }

    document.querySelectorAll(".panel-section").forEach((secao) => {
      const titulo = secao.querySelector(".section-title");
      if (!titulo) return;
      titulo.style.cursor = "pointer";
      titulo.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        abrirPainel(secao);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initFloating, { once: true });
  } else {
    initFloating();
  }
})();

/* -----------------------
   Render loop placeholder (desenha algo no canvas para visualizar)
   ----------------------- */
(function renderLoop() {
  if (!canvas || !ctx) return;
  let t = 0;
  function frame() {
    // apenas desenha um fundo simples e o tempo (placeholder)
    ctx.fillStyle = "#071018";
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = "#72f0b0";
    ctx.font = "28px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Lyric Studio Preview", canvas.width/2, 60);
    ctx.font = "20px sans-serif";
    ctx.fillStyle = "#91a0b1";
    ctx.fillText("Use Timeline para arrastar legendas", canvas.width/2, 96);
    t++;
    requestAnimationFrame(frame);
  }
  frame();
})();
