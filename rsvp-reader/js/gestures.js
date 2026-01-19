export function attachTapToToggle({ readerPane, reader, ignoreSelector = "button, a, input, select, textarea, label" }) {
  let last = 0;
  readerPane.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.closest(ignoreSelector)) return;
    const now = Date.now();
    if (now - last < 180) return;
    last = now;
    reader.isPaused() ? reader.start() : reader.pauseToggle();
  }, { passive: true });
}