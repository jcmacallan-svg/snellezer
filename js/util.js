export const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

export function isMobile() {
  return window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
}

export function safeJSONParse(raw, fallback = null) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

export function $(id) {
  return document.getElementById(id);
}