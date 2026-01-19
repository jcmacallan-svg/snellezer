import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs";
import { $, clamp } from "./util.js";
import { loadUI, saveUI, loadReadingState as loadReadingStateFromStateJs } from "./state.js";
import { createReader } from "./reader.js";
import { attachTapToToggle } from "./gestures.js";
import { createPreview } from "./preview.js";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs";

// ---------------- DOM ----------------
const dom = {
  fileInput: $("fileInput"),

  startPage: $("startPage"),
  reload: $("reload"),

  wpmNumber: $("wpmNumber"),
  wpmRange: $("wpmRange"),
  wpmRangeVal: $("wpmRangeVal"),

  mode: $("mode"),
  sentencePause: $("sentencePause"),
  commaPause: $("commaPause"),
  paraPause: $("paraPause"),

  fontSize: $("fontSize"),
  fontSizeVal: $("fontSizeVal"),
  pivotGapPx: $("pivotGapPx"),

  prevPage: $("prevPage"),
  nextPage: $("nextPage"),
  startBtn: $("startBtn"),
  pauseBtn: $("pauseBtn"),
  resetBtn: $("resetBtn"),

  readerPane: $("readerPane"),
  leftText: $("leftText"),
  pivot: $("pivot"),
  rightText: $("rightText"),

  fileStatus: $("fileStatus"),
  pageStatus: $("pageStatus"),
  wordStatus: $("wordStatus"),
  extractStatus: $("extractStatus"),

  // preview DOM
  previewBody: $("previewBody"),
  canvas: $("canvas"),
  previewPage: $("previewPage"),
  togglePreview: $("togglePreview"),
  fitMode: $("fitMode"),
  anchor: $("anchor"),
  zoom: $("zoom"),
  zoomVal: $("zoomVal"),
  lockPos: $("lockPos"),
};

// optional UI buttons (exist in your full index)
const burger = document.getElementById("burger");
const showControlsBtn = document.getElementById("showControlsBtn");

// ---------------- persistence (compat) ----------------
const LS_READING = "rsvp_reading_state_v1";

function loadReadingStateCompat() {
  // prefer state.js if it provides it
  try {
    const st = loadReadingStateFromStateJs?.();
    if (st) return st;
  } catch {}
  // fallback to our key
  try {
    return JSON.parse(localStorage.getItem(LS_READING) || "null");
  } catch {
    return null;
  }
}

function saveReadingStateCompat(state) {
  try {
    localStorage.setItem(LS_READING, JSON.stringify(state));
  } catch {}
}

// ---------------- enable controls ----------------
function enableControls() {
  [
    "reload",
    "prevPage",
    "nextPage",
    "startBtn",
    "pauseBtn",
    "resetBtn",

    "mode",
    "sentencePause",
    "commaPause",
    "paraPause",

    "wpmRange",
    "wpmNumber",

    "fontSize",
    "pivotGapPx",

    "togglePreview",
    "fitMode",
    "anchor",
    "zoom",
    "lockPos",
  ].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = false;
  });
}

// ---------------- UI apply ----------------
function applyFont() {
  const px = clamp(Number(dom.fontSize?.value || 72), 36, 96);
  document.documentElement.style.setProperty("--fontPx", px + "px");
  if (dom.fontSizeVal) dom.fontSizeVal.textContent = String(px);

  const gap = clamp(Number(dom.pivotGapPx?.value || 8), 4, 20);
  document.documentElement.style.setProperty("--pivotGap", gap + "px");

  saveUI(dom);
}

function syncWPM(from) {
  if (!dom.wpmNumber || !dom.wpmRange) return;
  let v = from === "range" ? Number(dom.wpmRange.value) : Number(dom.wpmNumber.value);
  v = clamp(v, 100, 900);
  dom.wpmRange.value = String(v);
  dom.wpmNumber.value = String(v);
  if (dom.wpmRangeVal) dom.wpmRangeVal.textContent = String(v);
  saveUI(dom);
}

// ---------------- extraction (lazy + cached) ----------------
function markChapterBreaks(wordObjs) {
  const isAllCaps = (s) => /^[A-Z0-9ÄÖÜÉÈÊÁÀÂÍÌÎÓÒÔÚÙÛÇÑ]+$/.test(s) && /[A-Z]/.test(s);
  let lineStart = 0;
  for (let i = 0; i < wordObjs.length; i++) {
    if (wordObjs[i].eolAfter) {
      const line = wordObjs.slice(lineStart, i + 1).map((x) => x.w || "");
      const clean = line.join(" ").trim();
      const wcount = line.filter(Boolean).length;
      const hasChapter = /\b(chapter|hoofdstuk|kapitel)\b/i.test(clean);
      const looksHeading =
        wcount <= 8 &&
        (hasChapter ||
          isAllCaps(
            clean
              .replace(/[^A-Z0-9ÄÖÜÉÈÊÁÀÂÍÌÎÓÒÔÚÙÛÇÑ ]/g, "")
              .replace(/\s+/g, " ")
              .trim()
          ));
      if (looksHeading) {
        wordObjs[i].paraAfter = true;
        wordObjs[i].chapterAfter = true;
      }
      lineStart = i + 1;
    }
  }
}

let pdf = null;
let pdfFileName = "";
const pageCache = new Map(); // page -> wordObjs

const preview = createPreview({ dom, getPdf: () => pdf });

async function getPageWords(p) {
  if (!pdf) return [];
  if (pageCache.has(p)) return pageCache.get(p);

  if (dom.extractStatus) dom.extractStatus.textContent = `Extract: working… (page ${p})`;
  const page = await pdf.getPage(p);
  const content = await page.getTextContent();

  const wordObjs = [];
  let eolStreak = 0;

  for (const it of content.items) {
    const s = (it.str || "").trim();
    if (s) {
      const parts = s.split(/\s+/).filter(Boolean);
      for (const part of parts) {
        wordObjs.push({ w: part, eolAfter: false, paraAfter: false, chapterAfter: false });
      }
      eolStreak = 0;
    }
    if (it.hasEOL) {
      eolStreak += 1;
      if (wordObjs.length) {
        const last = wordObjs[wordObjs.length - 1];
        last.eolAfter = true;
        if (eolStreak >= 2) last.paraAfter = true;
      }
    }
  }

  markChapterBreaks(wordObjs);
  pageCache.set(p, wordObjs);

  if (dom.extractStatus) dom.extractStatus.textContent = `Extract: cached ${pageCache.size}/${pdf.numPages}`;
  return wordObjs;
}

// ---------------- focus/fullscreen ----------------
async function toggleFullscreenFocus() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      document.body.classList.add("kiosk");
      document.body.classList.add("sidebar-collapsed");
    } else {
      await document.exitFullscreen();
      document.body.classList.remove("kiosk");
    }
  } catch (e) {
    console.warn(e);
  }
}

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) {
    document.body.classList.remove("kiosk");
  }
});

// ---------------- reader ----------------
const reader = createReader({
  dom,
  pdfRef: () => pdf,
  pdfNameRef: () => pdfFileName,
  extractorRef: () => getPageWords,
  previewRef: () => preview,
  rsvpEls: { leftEl: dom.leftText, pivotEl: dom.pivot, rightEl: dom.rightText },
  persist: {
    load: loadReadingStateCompat,
    save: saveReadingStateCompat,
    key: LS_READING,
  },
});

// ---------------- events ----------------
dom.fontSize?.addEventListener("input", applyFont);
dom.pivotGapPx?.addEventListener("input", applyFont);

dom.wpmRange?.addEventListener("input", () => syncWPM("range"));
dom.wpmNumber?.addEventListener("input", () => syncWPM("number"));

dom.startBtn?.addEventListener("click", () => {
  reader.start();
  // auto-hide controls when reading starts
  document.body.classList.add("sidebar-collapsed");
});

dom.pauseBtn?.addEventListener("click", () => reader.pauseToggle());
dom.resetBtn?.addEventListener("click", () => reader.reset());
dom.prevPage?.addEventListener("click", () => reader.prev());
dom.nextPage?.addEventListener("click", () => reader.next());

dom.reload?.addEventListener("click", async () => {
  if (!pdf) return;
  const p = clamp(Number(dom.startPage?.value || 1), 1, pdf.numPages);
  await reader.loadPage(p, { resetWord: true });
});

// tap-to-toggle on the reader pane
attachTapToToggle({ readerPane: dom.readerPane, reader });

// Keyboard shortcuts (robust via e.code)
// Space = pause/resume
// P = toggle preview
// H = toggle sidebar
// F = fullscreen focus toggle
// Esc = exit fullscreen
document.addEventListener("keydown", (e) => {
  // don't hijack keys while typing
  const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
  const typing = tag === "input" || tag === "textarea" || tag === "select";
  if (typing) return;

  if (e.code === "Space") {
    e.preventDefault();
    reader.pauseToggle();
    return;
  }

  if (e.code === "KeyP") {
    const btn = dom.togglePreview;
    if (btn && !btn.disabled) {
      e.preventDefault();
      btn.click();
    }
    return;
  }

  if (e.code === "KeyH") {
    e.preventDefault();
    document.body.classList.toggle("sidebar-collapsed");
    return;
  }

  if (e.code === "KeyF") {
    e.preventDefault();
    toggleFullscreenFocus();
    return;
  }

  if (e.code === "Escape") {
    if (document.fullscreenElement) {
      e.preventDefault();
      document.exitFullscreen().catch(() => {});
    }
  }
});

// burger toggles sidebar
if (burger) {
  burger.addEventListener("click", () => {
    document.body.classList.toggle("sidebar-collapsed");
  });
}

// show controls temporarily (if button exists)
if (showControlsBtn) {
  showControlsBtn.addEventListener("click", () => {
    document.body.classList.remove("sidebar-collapsed");
    window.clearTimeout(window.__hideT);
    window.__hideT = window.setTimeout(() => {
      document.body.classList.add("sidebar-collapsed");
    }, 4000);
  });
}

// ---------------- load pdf ----------------
async function loadPDFArrayBuffer(buffer, name) {
  pdfFileName = name;
  if (dom.fileStatus) dom.fileStatus.textContent = name;
  pageCache.clear();

  pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  enableControls();
  loadUI(dom);

  // preview init
  preview.setZoomFromUI?.();
  preview.setCurrentPage?.(1);
  if (!document.body.classList.contains("preview-collapsed")) {
    preview.queueRender?.(1);
  }

  applyFont();
  syncWPM("number");
  document.body.classList.add("has-pdf");

  if (dom.pageStatus) dom.pageStatus.textContent = `Page: 1/${pdf.numPages}`;
  if (dom.wordStatus) dom.wordStatus.textContent = `Word: –`;

  // restore if matching
  const st = loadReadingStateCompat();
  if (st && st.fileName === pdfFileName && st.numPages === pdf.numPages) {
    if (typeof st.wpm === "number" && dom.wpmNumber) {
      dom.wpmNumber.value = String(clamp(st.wpm, 100, 900));
      syncWPM("number");
    }
    const p = clamp(Number(st.last?.page || 1), 1, pdf.numPages);
    const off = Math.max(0, Number(st.last?.wordOffsetInPage || 0));

    await reader.loadPage(p, { resetWord: true });
    reader.setIdx(off);

    // keep preview in sync with restored page
    preview.setCurrentPage?.(p);
    if (!document.body.classList.contains("preview-collapsed")) {
      preview.queueRender?.(p);
    }
  } else {
    await reader.loadPage(clamp(Number(dom.startPage?.value || 1), 1, pdf.numPages), { resetWord: true });
  }
}

dom.fileInput?.addEventListener("change", async () => {
  const f = dom.fileInput.files?.[0];
  if (!f) return;
  const buf = await f.arrayBuffer();
  await loadPDFArrayBuffer(buf, f.name);

  // show controls after upload
  document.body.classList.remove("sidebar-collapsed");
});

// ---------------- auto-load bundled pdf on startup ----------------
async function autoLoadBundled() {
  if (pdf) return;

  try {
    const res = await fetch("./pdf/mcnamara.pdf", { cache: "no-store" });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    const buf = await res.arrayBuffer();
    await loadPDFArrayBuffer(buf, "mcnamara.pdf");
  } catch (err) {
    console.error(err);
    if (dom.fileStatus) dom.fileStatus.textContent = "No default PDF";
  }
}

autoLoadBundled();
