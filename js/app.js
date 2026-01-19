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

// Extra UI elements (from your 3-pane index)
const burger = document.getElementById("burger");          // ☰ in sidebar header
const sideToggle = document.getElementById("sideToggle");  // ⟨/⟩ floating chevron (desktop/min)
const sideTitle = document.getElementById("sideTitle");
const fsBtn = document.getElementById("fsBtn");
const showControlsBtn = document.getElementById("showControlsBtn");

const mobileMenuBtn = document.getElementById("mobileMenuBtn");
const mobilePdfBtn = document.getElementById("mobilePdfBtn");
const backdrop = document.getElementById("backdrop");

// ---------------- keys overlay (always visible) ----------------
function ensureHotkeysOverlay() {
  if (document.getElementById("hotkeysOverlay")) return;

  const el = document.createElement("div");
  el.id = "hotkeysOverlay";
  el.style.position = "fixed";
  el.style.right = "10px";
  el.style.bottom = "44px";
  el.style.zIndex = "999";
  el.style.fontSize = "12px";
  el.style.color = "#9ba3af";
  el.style.background = "rgba(15,21,36,.92)";
  el.style.border = "1px solid #2b2b2b";
  el.style.borderRadius = "12px";
  el.style.padding = "8px 10px";
  el.style.userSelect = "none";
  el.style.maxWidth = "260px";
  el.style.lineHeight = "1.25";

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
      <div style="font-weight:700;color:#e6edf3;">Controls</div>
      <button id="hotkeysHideBtn" style="
        background:transparent;border:1px solid #2b2b2b;color:#e6edf3;
        border-radius:10px;padding:3px 8px;cursor:pointer;
      ">×</button>
    </div>
    <div style="margin-top:6px;">
      <div><b>Click/Tap</b>: Start/Pause</div>
      <div><b>Space</b>: Pause/Resume</div>
      <div><b>H</b>: Sidebar mini</div>
      <div><b>P</b>: Toggle preview</div>
      <div><b>F</b>: Fullscreen</div>
      <div style="opacity:.9;margin-top:6px;">Mobile: ☰ opens menu</div>
    </div>
  `;
  document.body.appendChild(el);

  const hideBtn = document.getElementById("hotkeysHideBtn");
  hideBtn?.addEventListener("click", () => el.remove());
}

ensureHotkeysOverlay();

// ---------------- persistence (compat) ----------------
const LS_READING = "rsvp_reading_state_v1";

function loadReadingStateCompat() {
  try {
    const st = loadReadingStateFromStateJs?.();
    if (st) return st;
  } catch {}
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

function isTypingTarget(t) {
  const tag = (t && t.tagName) ? t.tagName.toLowerCase() : "";
  return tag === "input" || tag === "textarea" || tag === "select";
}

const isMobile = () => window.matchMedia && window.matchMedia("(max-width: 900px)").matches;

// ---------------- sidebar drawer (mobile) ----------------
// ---------------- sidebar drawer (mobile) ----------------
function openDrawer() {
  document.body.classList.add("sidebar-open");
}

function closeDrawer() {
  document.body.classList.remove("sidebar-open");
}

function toggleDrawer() {
  if (document.body.classList.contains("sidebar-open")) closeDrawer();
  else openDrawer();
}

// Mobile menu button (top-left floating)
mobileMenuBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  toggleDrawer();
});

// Sidebar header burger should also toggle drawer on mobile
burger?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (isMobile()) toggleDrawer();
  else toggleSidebarCollapsed();
});

// Clicking the dark backdrop closes the drawer
backdrop?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  closeDrawer();
});

// Escape closes drawer on mobile
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isMobile()) closeDrawer();
});


// Desktop: min vs collapsed
function setSidebarMin(on) {
  document.body.classList.toggle("sidebar-min", !!on);
  if (on) document.body.classList.remove("sidebar-collapsed");
  saveUI(dom);
}
function toggleSidebarMin() {
  setSidebarMin(!document.body.classList.contains("sidebar-min"));
}
function toggleSidebarCollapsed() {
  const on = document.body.classList.contains("sidebar-collapsed");
  document.body.classList.toggle("sidebar-collapsed", !on);
  if (!on) document.body.classList.remove("sidebar-min");
  saveUI(dom);
}

// ---------------- enable controls ----------------
function enableControls() {
  [
    "reload","prevPage","nextPage","startBtn","pauseBtn","resetBtn",
    "mode","sentencePause","commaPause","paraPause",
    "wpmRange","wpmNumber","fontSize","pivotGapPx",
    "togglePreview","fitMode","anchor","zoom","lockPos",
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
            clean.replace(/[^A-Z0-9ÄÖÜÉÈÊÁÀÂÍÌÎÓÒÔÚÙÛÇÑ ]/g, "")
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
const pageCache = new Map();

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

// ---------------- fullscreen focus ----------------
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

// ---------------- click/tap on readerPane to start/pause (desktop+mobile) ----------------
(function attachClickToggle() {
  const pane = dom.readerPane || document.body;
  let last = 0;
  pane.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.closest("button, a, input, select, textarea, label")) return;
    if (!pdf) return;

    const now = Date.now();
    if (now - last < 180) return;
    last = now;

    // Try to infer pause state safely:
    // If pause button text is "Pause" and reader is running -> pauseToggle works anyway.
    reader.pauseToggle();
  });
})();

// Keep your mobile gestures module too (if it exists)
attachTapToToggle({ readerPane: dom.readerPane, reader });

// ---------------- UI events ----------------
dom.fontSize?.addEventListener("input", applyFont);
dom.pivotGapPx?.addEventListener("input", applyFont);

dom.wpmRange?.addEventListener("input", () => syncWPM("range"));
dom.wpmNumber?.addEventListener("input", () => syncWPM("number"));

dom.startBtn?.addEventListener("click", () => {
  reader.start();
  // Auto-hide: after start, go minimal on desktop
  if (!isMobile()) setSidebarMin(true);
  // On mobile, close drawer to show reading space
  closeDrawer();
});

dom.pauseBtn?.addEventListener("click", () => reader.pauseToggle());
dom.resetBtn?.addEventListener("click", () => reader.reset());
dom.prevPage?.addEventListener("click", () => reader.prev());
dom.nextPage?.addEventListener("click", () => reader.next());

dom.reload?.addEventListener("click", async () => {
  if (!pdf) return;
  const p = clamp(Number(dom.startPage?.value || 1), 1, pdf.numPages);
  await reader.loadPage(p, { resetWord: true });

  // Make sure preview follows
  preview.setCurrentPage?.(p);
  if (!document.body.classList.contains("preview-collapsed")) {
    preview.queueRender?.(p);
  }
});

dom.togglePreview?.addEventListener("click", () => {
  document.body.classList.toggle("preview-collapsed");
  saveUI(dom);
});

// Desktop sidebar toggles
burger?.addEventListener("click", () => {
  // On mobile: burger should open/close drawer; on desktop: collapse
  if (isMobile()) {
    if (document.body.classList.contains("sidebar-open")) closeDrawer();
    else openDrawer();
  } else {
    toggleSidebarCollapsed();
  }
});

sideToggle?.addEventListener("click", () => {
  // Chevron toggles minimal on desktop; on mobile just open drawer
  if (isMobile()) openDrawer();
  else toggleSidebarMin();
});

sideTitle?.addEventListener("click", () => {
  if (isMobile()) openDrawer();
  else toggleSidebarMin();
});

fsBtn?.addEventListener("click", () => toggleFullscreenFocus());

showControlsBtn?.addEventListener("click", () => {
  document.body.classList.remove("sidebar-min");
  document.body.classList.remove("sidebar-collapsed");
  saveUI(dom);
});

// Mobile drawer buttons
mobileMenuBtn?.addEventListener("click", openDrawer);
backdrop?.addEventListener("click", closeDrawer);

mobilePdfBtn?.addEventListener("click", () => {
  const btn = dom.togglePreview;
  if (btn && !btn.disabled) btn.click();
});

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if (isTypingTarget(e.target)) return;

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

  // H = sidebar MIN mode (desktop)
  if (e.code === "KeyH") {
    e.preventDefault();
    if (!isMobile()) toggleSidebarMin();
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
    // also close drawer on mobile
    if (isMobile()) closeDrawer();
  }
});

// ---------------- load pdf ----------------
async function loadPDFArrayBuffer(buffer, name) {
  pdfFileName = name;
  if (dom.fileStatus) dom.fileStatus.textContent = name;
  pageCache.clear();

  pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  enableControls();
  loadUI(dom);

  applyFont();
  syncWPM("number");
  document.body.classList.add("has-pdf");

  // Restore state
  const st = loadReadingStateCompat();

  if (st && st.fileName === pdfFileName && st.numPages === pdf.numPages) {
    if (typeof st.wpm === "number" && dom.wpmNumber) {
      dom.wpmNumber.value = String(clamp(st.wpm, 100, 900));
      syncWPM("number");
    }
    const p = clamp(Number(st.last?.page || 1), 1, pdf.numPages);
    const off = Math.max(0, Number(st.last?.wordOffsetInPage || 0));

    // Update UI start page
    if (dom.startPage) dom.startPage.value = String(p);

    await reader.loadPage(p, { resetWord: true });
    reader.setIdx(off);

    // ✅ IMPORTANT FIX: preview should follow restored page
    preview.setCurrentPage?.(p);
    if (!document.body.classList.contains("preview-collapsed")) {
      preview.queueRender?.(p);
    }

    if (dom.pageStatus) dom.pageStatus.textContent = `Page: ${p}/${pdf.numPages}`;
  } else {
    const p = clamp(Number(dom.startPage?.value || 1), 1, pdf.numPages);
    await reader.loadPage(p, { resetWord: true });

    preview.setCurrentPage?.(p);
    if (!document.body.classList.contains("preview-collapsed")) {
      preview.queueRender?.(p);
    }

    if (dom.pageStatus) dom.pageStatus.textContent = `Page: ${p}/${pdf.numPages}`;
  }
}

dom.fileInput?.addEventListener("change", async () => {
  const f = dom.fileInput.files?.[0];
  if (!f) return;
  const buf = await f.arrayBuffer();
  await loadPDFArrayBuffer(buf, f.name);

  // After upload: show controls
  document.body.classList.remove("sidebar-min");
  document.body.classList.remove("sidebar-collapsed");
  saveUI(dom);
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
window.addEventListener("DOMContentLoaded", () => {
  autoLoadBundled();
});

