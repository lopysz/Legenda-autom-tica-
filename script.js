"use strict";

const $ = (id) => document.getElementById(id);

const tituloInput = $("titulo");
const dataInput = $("dataContagem");
const setorInput = $("setor");
const dadosInput = $("dados");
const mensagem = $("mensagem");

let itensInterpretados = [];

function dataHojeISO() {
  const agora = new Date();
  const local = new Date(agora.getTime() - agora.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function formatarData(valor) {
  if (!valor) return "—";
  const partes = valor.split("-");
  return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : valor;
}

function numeroSeguro(valor) {
  if (valor === undefined || valor === null || String(valor).trim() === "") return null;
  const normalizado = String(valor).trim().replace(/\s/g, "").replace(",", ".");
  const n = Number(normalizado);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function formatarNumero(n) {
  return Number(n || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function mostrarMensagem(texto, tipo = "info") {
  mensagem.textContent = texto;
  mensagem.className = `message show ${tipo}`;
}

function escaparHTML(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function extrairPares(texto) {
  const resultado = [];
  // Aceita 33=12, 33:12, 33-12 ou 33 x 12, separados por vírgulas/ponto e vírgula.
  const partes = texto.split(/[;,|\n]+/);
  for (const parte of partes) {
    const m = parte.trim().match(/^(.+?)\s*(?:=|:|\s+x\s+|\s+-\s+)\s*(\d+(?:[.,]\d+)?)$/i);
    if (!m) continue;
    const qtd = numeroSeguro(m[2]);
    if (qtd === null) continue;
    resultado.push({ tamanho: m[1].trim(), quantidade: qtd });
  }
  return resultado;
}

function interpretarTexto(texto) {
  const linhas = texto.replace(/\r/g, "").split("\n");
  const itens = [];
  let atual = null;
  const metadados = { setor: "", data: "" };

  function finalizar() {
    if (!atual) return;
    atual.nome = atual.nome.trim();
    atual.descricao = atual.descricao.trim();
    if (atual.nome) {
      if (atual.tamanhos.length) {
        atual.total = atual.tamanhos.reduce((s, x) => s + x.quantidade, 0);
        atual.tipoQuantidade = "grade";
      } else {
        atual.total = atual.quantidadeInformada ?? 0;
        atual.tipoQuantidade = "unidades";
      }
      itens.push(atual);
    }
    atual = null;
  }

  for (const linhaOriginal of linhas) {
    const linha = linhaOriginal.trim();
    if (!linha) continue;

    const metaSetor = linha.match(/^(?:setor|local|unidade)\s*:\s*(.+)$/i);
    if (metaSetor) { metadados.setor = metaSetor[1].trim(); continue; }
    const metaData = linha.match(/^(?:data(?:\s+da\s+contagem)?|data\s+do\s+invent[aá]rio)\s*:\s*(.+)$/i);
    if (metaData) { metadados.data = metaData[1].trim(); continue; }

    const itemMatch = linha.match(/^(?:item|epi|equipamento|produto)\s*:\s*(.+)$/i);
    if (itemMatch) {
      finalizar();
      atual = { nome: itemMatch[1].trim(), descricao: "", tamanhos: [], quantidadeInformada: null, total: 0 };
      continue;
    }

    // Aceita títulos numerados como "1. Sapato E.V.A. — Total: 116 pares".
    const tituloNumerado = linha.match(/^\d+[.)]\s*(.+?)(?:\s+[—–-]\s+|\s{2,}|$)/);
    if (!atual && tituloNumerado) {
      atual = { nome: tituloNumerado[1].trim(), descricao: "", tamanhos: [], quantidadeInformada: null, total: 0 };
      continue;
    }

    if (!atual) {
      // Linhas sem rótulo também podem ser nomes de itens; cabeçalhos comuns são ignorados.
      if (!/^(invent[aá]rio|relat[oó]rio|almoxarifado|data|tamanho|quantidade|qtd\.?|descri[cç][aã]o)\b/i.test(linha)) {
        atual = { nome: linha.replace(/^\d+[.)]\s*/, "").trim(), descricao: "", tamanhos: [], quantidadeInformada: null, total: 0 };
      }
      continue;
    }

    const desc = linha.match(/^(?:descri[cç][aã]o|detalhes?|observa[cç][aã]o)\s*:\s*(.+)$/i);
    if (desc) { atual.descricao = desc[1].trim(); continue; }

    const grade = linha.match(/^(?:tamanhos?|grade|numera[cç][aã]o|quantidades?\s+por\s+tamanho)\s*:\s*(.+)$/i);
    if (grade) { atual.tamanhos = extrairPares(grade[1]); continue; }

    const qtd = linha.match(/^(?:quantidade|qtd\.?|total)\s*:\s*([\d.,]+)(?:\s+.*)?$/i);
    if (qtd) {
      const n = numeroSeguro(qtd[1]);
      if (n !== null) atual.quantidadeInformada = n;
      continue;
    }

    // Se a linha não tiver rótulo, tenta ler pares de tamanhos ou adiciona à descrição.
    const pares = extrairPares(linha);
    if (pares.length) atual.tamanhos = atual.tamanhos.concat(pares);
    else atual.descricao = atual.descricao ? `${atual.descricao} ${linha}` : linha;
  }
  finalizar();
  return { itens, metadados };
}

function atualizarMetadados(meta) {
  if (meta.setor && !setorInput.value.trim()) setorInput.value = meta.setor;
  if (meta.data && !dataInput.dataset.userChanged) {
    const match = meta.data.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (match) dataInput.value = `${match[3]}-${match[2]}-${match[1]}`;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(meta.data)) dataInput.value = meta.data;
  }
}

function renderizarPreview() {
  const titulo = tituloInput.value.trim() || "RELATÓRIO DE INVENTÁRIO DE EPIs";
  const setor = setorInput.value.trim() || "Não informado";
  const data = formatarData(dataInput.value);
  const total = itensInterpretados.reduce((s, item) => s + item.total, 0);

  $("previewTitulo").textContent = titulo;
  $("previewData").textContent = data;
  $("previewSetor").textContent = setor;
  $("previewTotal").textContent = `${formatarNumero(total)} unidades`;
  $("totalItens").textContent = formatarNumero(itensInterpretados.length);
  $("totalUnidades").textContent = formatarNumero(total);

  const cont = $("previewItens");
  if (!itensInterpretados.length) {
    cont.innerHTML = `<div class="empty-state"><span>▤</span><strong>Seu relatório aparecerá aqui</strong><p>Cole os dados à esquerda e clique em “Interpretar dados”.</p></div>`;
    return;
  }

  cont.innerHTML = itensInterpretados.map((item, index) => {
    let detalhe = "";
    if (item.tamanhos.length) {
      detalhe = `<table class="size-table"><thead><tr><th>Tamanho/modelo</th>${item.tamanhos.map(x => `<th>${escaparHTML(x.tamanho)}</th>`).join("")}</tr></thead><tbody><tr><th>Quantidade</th>${item.tamanhos.map(x => `<td>${formatarNumero(x.quantidade)}</td>`).join("")}</tr></tbody></table>`;
    } else {
      detalhe = `<div class="item-details">Quantidade: <strong>${formatarNumero(item.total)} unidade(s)</strong></div>`;
    }
    return `<article class="item-block">
      <div class="item-title"><strong>${index + 1}. ${escaparHTML(item.nome)}</strong><span class="item-total">Total: ${formatarNumero(item.total)}</span></div>
      ${item.descricao ? `<p class="item-description">${escaparHTML(item.descricao)}</p>` : ""}
      <div class="item-details">${detalhe}</div>
    </article>`;
  }).join("");
}

function processarDados() {
  const texto = dadosInput.value.trim();
  if (!texto) {
    itensInterpretados = [];
    renderizarPreview();
    mostrarMensagem("Cole os dados do inventário antes de interpretar.", "warning");
    return;
  }
  const resultado = interpretarTexto(texto);
  itensInterpretados = resultado.itens;
  atualizarMetadados(resultado.metadados);
  renderizarPreview();

  if (!itensInterpretados.length) {
    mostrarMensagem("Não consegui identificar itens. Use, por exemplo, “Item: Capacete” e “Quantidade: 45”.", "warning");
    return;
  }

  const soma = itensInterpretados.reduce((s, item) => s + item.total, 0);
  const gradeCount = itensInterpretados.filter(x => x.tamanhos.length).length;
  mostrarMensagem(`${itensInterpretados.length} item(ns) identificado(s), totalizando ${formatarNumero(soma)} unidade(s). ${gradeCount ? `${gradeCount} item(ns) têm grade de tamanhos.` : ""} Confira a prévia antes de exportar.`, "success");
}

function criarPDF() {
  if (!itensInterpretados.length) {
    processarDados();
    if (!itensInterpretados.length) return;
  }
  if (!window.jspdf || !window.jspdf.jsPDF) {
    mostrarMensagem("A biblioteca de PDF não carregou. Verifique a conexão com a internet e recarregue a página.", "warning");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  const titulo = tituloInput.value.trim() || "RELATÓRIO DE INVENTÁRIO DE EPIs";
  const setor = setorInput.value.trim() || "Não informado";
  const data = formatarData(dataInput.value);
  const totalGeral = itensInterpretados.reduce((s, item) => s + item.total, 0);

  function cabecalho() {
    doc.setFillColor(16, 38, 61);
    doc.roundedRect(margin, 12, 13, 13, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("EPI", margin + 6.5, 19.5, { align: "center" });
    doc.setTextColor(16, 38, 61);
    doc.setFont("helvetica", "bold);
    doc.setFontSize(15);
    const tituloLinhas = doc.splitTextToSize(titulo, contentWidth - 19);
    doc.text(tituloLinhas, margin + 19, 17);
    const afterTitle = 17 + (tituloLinhas.length - 1) * 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(95, 112, 130);
    doc.text("Controle interno de estoque e equipamentos de proteção", margin + 19, afterTitle + 5);
    const lineY = Math.max(31, afterTitle + 9);
    doc.setDrawColor(16, 38, 61);
    doc.setLineWidth(0.8);
    doc.line(margin, lineY, pageWidth - margin, lineY);

    const boxY = lineY + 5;
    const gap = 3;
    const boxW = (contentWidth - gap * 2) / 3;
    const metas = [
      ["DATA DA CONTAGEM", data],
      ["SETOR", setor],
      ["TOTAL GERAL", `${formatarNumero(totalGeral)} unidades`]
    ];
    metas.forEach((m, i) => {
      const x = margin + i * (boxW + gap);
      doc.setFillColor(243, 246, 249);
      doc.roundedRect(x, boxY, boxW, 15, 1.5, 1.5, "F");
      doc.setTextColor(101, 119, 137);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.text(m[0], x + 3, boxY + 5);
      doc.setTextColor(27, 48, 69);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      const val = doc.splitTextToSize(m[1], boxW - 6);
      doc.text(val.slice(0, 2), x + 3, boxY + 10);
    });
    return boxY + 21;
  }

  let y = cabecalho();
  itensInterpretados.forEach((item, index) => {
    const estimated = item.tamanhos.length ? 25 : 22;
    if (y + estimated > 275) {
      doc.addPage();
      y = 16;
    }
    doc.setFillColor(245, 248, 251);
    doc.setDrawColor(224, 230, 237);
    doc.roundedRect(margin, y, contentWidth, 9, 1.5, 1.5, "FD");
    doc.setTextColor(25, 48, 70);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    const nome = doc.splitTextToSize(`${index + 1}. ${item.nome}`, contentWidth - 35);
    doc.text(nome.slice(0, 2), margin + 3, y + 5.8);
    doc.setTextColor(40, 91, 168);
    doc.setFontSize(8);
    doc.text(`Total: ${formatarNumero(item.total)}`, pageWidth - margin - 3, y + 5.8, { align: "right" });
    y += 10;

    if (item.descricao) {
      doc.setFont("helvetica", "normal");
      doc.setTextColor(90, 106, 123);
      doc.setFontSize(8);
      const linhas = doc.splitTextToSize(item.descricao, contentWidth - 4);
      doc.text(linhas, margin + 2, y + 3);
      y += linhas.length * 4 + 4;
    }

    if (item.tamanhos.length) {
      const headers = ["Tamanho/modelo", ...item.tamanhos.map(x => String(x.tamanho))];
      const row = ["Quantidade", ...item.tamanhos.map(x => formatarNumero(x.quantidade))];
      const colWidths = {};
      colWidths[0] = { cellWidth: 27 };
      doc.autoTable({
        startY: y,
        head: [headers],
        body: [row],
        margin: { left: margin, right: margin },
        tableWidth: contentWidth,
        theme: "grid",
        styles: { font: "helvetica", fontSize: item.tamanhos.length > 10 ? 6 : 7, cellPadding: 1.8, halign: "center", textColor: [49, 70, 91], lineColor: [224, 230, 237], lineWidth: 0.15 },
        headStyles: { fillColor: [237, 242, 247], textColor: [61, 83, 105], fontStyle: "bold" },
        columnStyles: colWidths,
        didDrawPage: () => {}
      });
      y = doc.lastAutoTable.finalY + 7;
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(49, 70, 91);
      doc.text(`Quantidade: ${formatarNumero(item.total)} unidade(s)`, margin + 3, y + 4);
      y += 11;
    }
    if (y > 270 && index < itensInterpretados.length - 1) {
      doc.addPage();
      y = 16;
    }
  });

  const paginas = doc.internal.getNumberOfPages();
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p);
    const h = doc.internal.pageSize.getHeight();
    doc.setDrawColor(224, 230, 237);
    doc.line(margin, h - 13, pageWidth - margin, h - 13);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(122, 137, 153);
    doc.text("Relatório Interno de Controle de Estoque · Almoxarifado Operacional", margin, h - 8);
    doc.text(`Página ${p} de ${paginas}`, pageWidth - margin, h - 8, { align: "right" });
  }

  const nomeArquivo = `inventario-epis-${dataInput.value || dataHojeISO()}.pdf`;
  doc.save(nomeArquivo);
  mostrarMensagem("PDF gerado. Confira o arquivo salvo no dispositivo.", "success");
}

function carregarExemplo() {
  setorInput.value = "Almoxarifado Operacional";
  dadosInput.value = `Setor: Almoxarifado Operacional
Data da contagem: ${formatarData(dataHojeISO())}

Item: Sapato E.V.A.
Tamanhos: 33=13, 34=0, 35=3, 36=72, 37=37, 38=64, 39=9, 40=0, 41=2, 42=0, 43=0, 44=9, 45=1, 46=4

Item: Capacete de segurança
Descrição: Capacete de proteção individual
Quantidade: 45

Item: Luva de proteção
Descrição: Luva de proteção mecânica
Quantidade: 120`;
  processarDados();
}

function limparTudo() {
  dadosInput.value = "";
  setorInput.value = "";
  tituloInput.value = "RELATÓRIO DE INVENTÁRIO DE EPIs";
  dataInput.value = dataHojeISO();
  itensInterpretados = [];
  mensagem.className = "message";
  renderizarPreview();
}

$("interpretarBtn").addEventListener("click", processarDados);
$("exemploBtn").addEventListener("click", carregarExemplo);
$("limparBtn").addEventListener("click", limparTudo);
$("pdfBtn").addEventListener("click", criarPDF);
$("imprimirBtn").addEventListener("click", () => {
  if (!itensInterpretados.length) processarDados();
  if (itensInterpretados.length) window.print();
});

[tituloInput, setorInput, dataInput].forEach(el => {
  el.addEventListener("input", () => {
    if (el === dataInput) dataInput.dataset.userChanged = "1";
    renderizarPreview();
  });
});

dataInput.value = dataHojeISO();
renderizarPreview();
