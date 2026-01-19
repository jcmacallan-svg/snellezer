import { clamp } from "./util.js";

function orpIndex(word) {
  const w = String(word || "");
  const L = w.length;
  if (L <= 1) return 0;
  if (L <= 5) return 1;
  if (L <= 9) return 2;
  if (L <= 13) return 3;
  return 4;
}

function renderRSVP(rsvpEls, wordObj) {
  const { leftEl, pivotEl, rightEl } = rsvpEls;
  const w = (wordObj && typeof wordObj === "object") ? (wordObj.w || "") : String(wordObj || "");
  if (!w) {
    if (leftEl) leftEl.textContent = "";
    if (pivotEl) pivotEl.textContent = "";
    if (rightEl) rightEl.textContent = "";
    return;
  }
  const i = Math.min(orpIndex(w), Math.max(0, w.length - 1));
  if (leftEl) leftEl.textContent = w.slice(0, i);
  if (pivotEl) pivotEl.textContent = w[i] || "";
  if (rightEl) rightEl.textContent = w.slice(i + 1);
}

function msPerWord(dom) {
  const wpm = clamp(Number(dom.wpmNumber?.value || 600), 100, 900);
  return 60000 / wpm;
}

function delayFor(dom, wordObj) {
  const base = msPerWord(dom);
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

  // tiny adaptive: long words / numbers
  const plain = w.replace(/[^\p{L}\p{N}]/gu, "");
  if (plain.length >= 12) d += 35;
  if (/\d/.test(plain) && plain.length >= 4) d += 25;

  return d;
}

export function createReader({ dom, pdfRef, pdfNameRef, extractorRef, previewRef, rsvpEls, persist }) {
  let currentPage = 1;
  let words = [];
  let idx = 0;

  let paused = true;
  let timer = null;

  function stopTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function updateStatus() {
    const pdf = pdfRef();
    if (!pdf) return;

    if (dom.pageStatus) dom.pageStatus.textContent = `Page: ${currentPage}/${pdf.numPages}`;
    if (dom.wordStatus) dom.wordStatus.textContent = `Word: ${Math.min(idx, words.length)}/${words.length}`;

    if (dom.prevPage) dom.prevPage.disabled = currentPage <= 1;
    if (dom.nextPage) dom.nextPage.disabled = currentPage >= pdf.numPages;
  }

  function saveProgress() {
    const pdf = pdfRef();
    if (!pdf || !persist?.save) return;

    persist.save({
      fileName: pdfNameRef(),
      numPages: pdf.numPages,
      wpm: Number(dom.wpmNumber?.value || 600),
      last: {
        page: currentPage,
        wordOffsetInPage: idx,
      },
    });
  }

  async function loadPage(p, { resetWord = true } = {}) {
    const pdf = pdfRef();
    if (!pdf) return;

    currentPage = clamp(Number(p || 1), 1, pdf.numPages);
    if (dom.startPage) dom.startPage.value = String(currentPage);

    const extractor = extractorRef();
    words = await extractor(currentPage);
    if (resetWord) idx = 0;

    // show first word immediately (nice UX)
    renderRSVP(rsvpEls, words[idx] || { w: "" });

    // keep preview aligned
    const pv = previewRef?.();
    pv?.setCurrentPage?.(currentPage);
    if (!document.body.classList.contains("preview-collapsed")) {
      pv?.queueRender?.(currentPage);
    }

    updateStatus();
    saveProgress();
  }

  function setIdx(newIdx) {
    idx = clamp(Number(newIdx || 0), 0, Math.max(0, words.length));
    renderRSVP(rsvpEls, words[Math.min(idx, Math.max(0, words.length - 1))] || { w: "" });
    updateStatus();
    saveProgress();
  }

  async function autoAdvanceIfNeeded() {
    const pdf = pdfRef();
    if (!pdf) return false;

    while (idx >= words.length) {
      if (currentPage >= pdf.numPages) return false;
      currentPage += 1;
      await loadPage(currentPage, { resetWord: true });
      if (words.length > 0) break;
    }
    return true;
  }

  async function tick() {
    if (paused) return;

    const ok = await autoAdvanceIfNeeded();
    if (!ok) {
      paused = true;
      stopTimer();
      renderRSVP(rsvpEls, { w: "" });
      return;
    }

    const w = words[idx];
    renderRSVP(rsvpEls, w);
    idx += 1;

    updateStatus();
    saveProgress();

    stopTimer();
    timer = setTimeout(() => tick(), delayFor(dom, w));
  }

  function start() {
    const pdf = pdfRef();
    if (!pdf) return;

    paused = false;
    stopTimer();
    tick();
  }

  function pauseToggle() {
    const pdf = pdfRef();
    if (!pdf) return;

    paused = !paused;
    if (!paused) tick();
    else stopTimer();
  }

  function reset() {
    paused = true;
    stopTimer();
    idx = 0;
    renderRSVP(rsvpEls, words[0] || { w: "" });
    updateStatus();
    saveProgress();
  }

  async function prev() {
    const pdf = pdfRef();
    if (!pdf) return;
    paused = true;
    stopTimer();
    const target = clamp(currentPage - 1, 1, pdf.numPages);
    await loadPage(target, { resetWord: true });
  }

  async function next() {
    const pdf = pdfRef();
    if (!pdf) return;
    paused = true;
    stopTimer();
    const target = clamp(currentPage + 1, 1, pdf.numPages);
    await loadPage(target, { resetWord: true });
  }

  return {
    start,
    pauseToggle,
    reset,
    prev,
    next,
    loadPage,
    setIdx,
  };
}
