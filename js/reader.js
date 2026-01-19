import { clamp } from "./util.js";
import { saveReadingState } from "./state.js";

function orpIndex(word) {
  const w = String(word || "");
  const L = w.length;
  if (L <= 1) return 0;
  if (L <= 5) return 1;
  if (L <= 9) return 2;
  if (L <= 13) return 3;
  return 4;
}

export function renderRSVP({ leftEl, pivotEl, rightEl }, wordObj) {
  const w = (typeof wordObj === "object") ? (wordObj?.w || "") : String(wordObj || "");
  if (!w) { leftEl.textContent = ""; pivotEl.textContent = ""; rightEl.textContent = ""; return; }
  const i = Math.min(orpIndex(w), Math.max(0, w.length - 1));
  leftEl.textContent = w.slice(0, i);
  pivotEl.textContent = w[i] || "";
  rightEl.textContent = w.slice(i + 1);
}

export function createDelayFor({ dom, msPerWord }) {
  return function delayFor(wordObj) {
    const base = msPerWord();
    const w = (wordObj && typeof wordObj === "object") ? (wordObj.w || "") : String(wordObj || "");
    let d = base;

    const endsSentence = /[.!?]$/.test(w);
    const endsComma = /[,;:]$/.test(w);

    const sentencePause = clamp(Number(dom.sentencePause?.value || 0), 0, 2000);
    const commaPause = clamp(Number(dom.commaPause?.value || 0), 0, 1000);
    const paraPause = clamp(Number(dom.paraPause?.value || 0), 0, 4000);

    if (endsComma) d += commaPause;
    if (endsSentence) d += sentencePause;
    if (wordObj?.paraAfter) d += paraPause;
    if (wordObj?.chapterAfter) d += Math.min(1200, paraPause + 500);

    // adaptive
    const plain = w.replace(/[^\p{L}\p{N}]/gu, "");
    if (plain.length >= 12) d += 35;
    if (/\d/.test(plain) && plain.length >= 4) d += 25;

    return d;
  };
}

export function createReader({
  dom,
  pdfRef,               // () => pdf
  pdfNameRef,           // () => file name
  extractorRef,         // () => async getPageWords(page)
  previewRef,           // () => { queueRender(page) } | null
  rsvpEls,
}) {
  let currentPage = 1;
  let activeWords = [];
  let idx = 0;
  let paused = true;
  let timer = null;

  const stop = () => { if (timer) clearTimeout(timer); timer = null; };

  const msPerWord = () => 60000 / clamp(Number(dom.wpmNumber?.value || 600), 100, 900);
  const delayFor = createDelayFor({ dom, msPerWord });

  function updateStatus() {
    const pdf = pdfRef();
    if (!pdf) return;
    dom.pageStatus.textContent = `Page: ${currentPage}/${pdf.numPages}`;
    dom.wordStatus.textContent = `Word: ${Math.min(idx, activeWords.length)}/${activeWords.length}`;
    if (dom.startPage) dom.startPage.value = String(currentPage);
    if (dom.prevPage) dom.prevPage.disabled = (currentPage <= 1);
    if (dom.nextPage) dom.nextPage.disabled = (currentPage >= pdf.numPages);
  }

  async function gotoPage(p, { resetWord = true } = {}) {
    const pdf = pdfRef();
    if (!pdf) return;
    currentPage = clamp(Number(p || 1), 1, pdf.numPages);

    const getPageWords = extractorRef();
    activeWords = getPageWords ? await getPageWords(currentPage) : [];
    if (resetWord) idx = 0;

    renderRSVP(rsvpEls, activeWords[Math.min(idx, Math.max(0, activeWords.length - 1))] || { w: "Ready" });

    updateStatus();
    const pv = previewRef();
pv?.setCurrentPage?.(currentPage);
pv?.queueRender?.(currentPage);

    saveReadingState({
      pdfFileName: pdfNameRef(),
      numPages: pdf.numPages,
      wpm: dom.wpmNumber?.value,
      page: currentPage,
      wordOffset: idx
    });
  }

  async function tick() {
    if (paused) return;
    const pdf = pdfRef();
    if (!pdf) return;

    // auto-advance pages (skip empty)
    while (idx >= activeWords.length) {
      if (currentPage < pdf.numPages) {
        await gotoPage(currentPage + 1, { resetWord: true });
        if (activeWords.length === 0) continue;
        break;
      } else {
        paused = true;
        stop();
        renderRSVP(rsvpEls, { w: "✓" });
        updateStatus();
        return;
      }
    }

    const w = activeWords[idx++];
    renderRSVP(rsvpEls, w);
    updateStatus();

    saveReadingState({
      pdfFileName: pdfNameRef(),
      numPages: pdf.numPages,
      wpm: dom.wpmNumber?.value,
      page: currentPage,
      wordOffset: idx
    });

    stop();
    timer = setTimeout(tick, delayFor(w));
  }

  return {
    isPaused: () => paused,
    getPage: () => currentPage,
    getIdx: () => idx,
    setIdx: (n) => { idx = Math.max(0, Number(n || 0)); updateStatus(); },
    loadPage: gotoPage,
    start: async () => { if (!pdfRef()) return; paused = false; stop(); await tick(); },
    pauseToggle: async () => { if (!pdfRef()) return; paused = !paused; if (!paused) await tick(); else stop(); },
    reset: async () => { if (!pdfRef()) return; paused = true; stop(); idx = 0; renderRSVP(rsvpEls, { w: "Reset" }); updateStatus(); },
    prev: async () => gotoPage(currentPage - 1),
    next: async () => gotoPage(currentPage + 1),
  };
}