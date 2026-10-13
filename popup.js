/* popup.js
   POPUPS FLOUTANTES — mover/mostrar panel-section como modal
   Cole este arquivo na mesma pasta do index.html (ou cole o conteúdo no final de script.js)
*/

(function () {
  function initFloating() {
    const bd = document.getElementById("floatingBackdrop");
    const ht = document.getElementById("floatingHost");
    if (!bd || !ht) return;

    let abertoState = {
      secao: null,
      originalParent: null,
      originalNext: null,
      wrapper: null
    };

    function restaurarSecao() {
      const s = abertoState.secao;
      const p = abertoState.originalParent;
      const next = abertoState.originalNext;
      const wrapper = abertoState.wrapper;
      if (!s) return;

      if (wrapper && s.parentNode && p) {
        try {
          p.insertBefore(s, next);
        } catch (e) {
          if (p && p.appendChild) p.appendChild(s);
        }
      }

      abertoState = { secao: null, originalParent: null, originalNext: null, wrapper: null };
    }

    function fecharPainel() {
      const wrapper = abertoState.wrapper;
      if (!wrapper) return;

      wrapper.classList.remove("open");
      bd.classList.remove("visible");

      restaurarSecao();

      setTimeout(() => {
        if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
      }, 200);

      document.body.style.overflow = "";

      if (wrapper.__lastFocus && typeof wrapper.__lastFocus.focus === "function") {
        try { wrapper.__lastFocus.focus(); } catch (e) {}
      }

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

      // mover a seção REAL para dentro do painel (preserva estado e listeners)
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

      bd.onclick = (ev) => {
        if (ev.target === bd) fecharPainel();
      };

      const onKey = (ev) => {
        if (ev.key === "Escape") {
          fecharPainel();
          document.removeEventListener("keydown", onKey);
        }
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

    ht.addEventListener("closeFloating", () => {
      if (abertoState.wrapper) fecharPainel();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initFloating, { once: true });
  } else {
    initFloating();
  }
})();
