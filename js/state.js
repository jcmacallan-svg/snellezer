import { clamp, safeJSONParse } from "./util.js";

export const LS_UI = "rsvp_ui_mod_v1";
export const LS_STATE = "rsvp_state_mod_v1";

export function saveUI(dom) {
  try {
    const ui = {
      wpm: Number(dom.wpmNumber?.value || 600),
      mode: dom.mode?.value || "comprehension",
      pauses: {
        sentence: Number(dom.sentencePause?.value || 220),
        comma: Number(dom.commaPause?.value || 120),
        para: Number(dom.paraPause?.value || 650),
      },
      fontPx: Number(dom.fontSize?.value || 72),
      pivotGap: Number(dom.pivotGapPx?.value || 8),
      preview: {
        collapsed: document.body.classList.contains("preview-collapsed"),
        fitMode: dom.fitMode?.value || "width",
        anchor: dom.anchor?.value || "center",
        zoom: Number(dom.zoom?.value || 120),
        lockPos: !!dom.lockPos?.checked,
      }
    };
    localStorage.setItem(LS_UI, JSON.stringify(ui));
  } catch {}
}

export function loadUI(dom) {
  const ui = safeJSONParse(localStorage.getItem(LS_UI), null);
  if (!ui) return;

  if (dom.wpmNumber && typeof ui.wpm === "number") dom.wpmNumber.value = String(clamp(ui.wpm, 100, 900));
  if (dom.mode && ui.mode) dom.mode.value = ui.mode;

  if (ui.pauses) {
    if (dom.sentencePause) dom.sentencePause.value = String(clamp(ui.pauses.sentence ?? 220, 0, 2000));
    if (dom.commaPause) dom.commaPause.value = String(clamp(ui.pauses.comma ?? 120, 0, 1000));
    if (dom.paraPause) dom.paraPause.value = String(clamp(ui.pauses.para ?? 650, 0, 4000));
  }

  if (dom.fontSize && typeof ui.fontPx === "number") dom.fontSize.value = String(clamp(ui.fontPx, 36, 96));
  if (dom.pivotGapPx && typeof ui.pivotGap === "number") dom.pivotGapPx.value = String(clamp(ui.pivotGap, 4, 20));

  if (ui.preview) {
    document.body.classList.toggle("preview-collapsed", !!ui.preview.collapsed);
    if (dom.fitMode && ui.preview.fitMode) dom.fitMode.value = ui.preview.fitMode;
    if (dom.anchor && ui.preview.anchor) dom.anchor.value = ui.preview.anchor;
    if (dom.zoom && typeof ui.preview.zoom === "number") dom.zoom.value = String(clamp(ui.preview.zoom, 70, 250));
    if (dom.lockPos) dom.lockPos.checked = !!ui.preview.lockPos;
  }
}

export function saveReadingState({ pdfFileName, numPages, wpm, page, wordOffset }) {
  try {
    localStorage.setItem(LS_STATE, JSON.stringify({
      fileName: pdfFileName,
      numPages,
      wpm: clamp(Number(wpm || 600), 100, 900),
      last: { page, wordOffsetInPage: Math.max(0, Number(wordOffset || 0)) }
    }));
  } catch {}
}

export function loadReadingState() {
  return safeJSONParse(localStorage.getItem(LS_STATE), null);
}