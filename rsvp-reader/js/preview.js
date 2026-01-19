import { clamp } from "./util.js";
import { saveUI } from "./state.js";

export function createPreview({ dom, getPdf }) {
  const canvas = dom.canvas;
  const ctx = canvas.getContext("2d");

  let currentRenderTask = null;
  let renderToken = 0;
  let renderInProgress = false;
  let pendingRenderPage = null;

  let zoom = 1.2;
  let lockedScroll = { xRatio: 0, yRatio: 0 };

  function isCollapsed() {
    return document.body.classList.contains("preview-collapsed");
  }

  function getScrollRatios() {
    const el = dom.previewBody;
    const maxX = Math.max(1, el.scrollWidth - el.clientWidth);
    const maxY = Math.max(1, el.scrollHeight - el.clientHeight);
    return {
      xRatio: clamp(el.scrollLeft / maxX, 0, 1),
      yRatio: clamp(el.scrollTop / maxY, 0, 1)
    };
  }

  function restoreScrollFromRatios(r) {
    const el = dom.previewBody;
    const maxX = Math.max(0, el.scrollWidth - el.clientWidth);
    const maxY = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollLeft = Math.round(clamp(r.xRatio, 0, 1) * maxX);
    el.scrollTop  = Math.round(clamp(r.yRatio, 0, 1) * maxY);
  }

  function applyAnchorAfterRender() {
    const el = dom.previewBody;
    const a = dom.anchor?.value || "center";
    if (a === "left") el.scrollLeft = 0;
    if (a === "center") el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2);
    if (a === "right") el.scrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    el.scrollTop = 0;
  }

  async function renderPDFPage(pageNum) {
    const pdf = getPdf();
    if (!pdf || isCollapsed()) return;

    pendingRenderPage = pageNum;
    if (renderInProgress) return;

    renderInProgress = true;
    try {
      while (pendingRenderPage != null) {
        const p = pendingRenderPage;
        pendingRenderPage = null;

        if (currentRenderTask) {
          try { currentRenderTask.cancel(); } catch {}
          try { await currentRenderTask.promise; } catch {}
          currentRenderTask = null;
        }

        const myToken = ++renderToken;

        if (dom.lockPos?.checked) lockedScroll = getScrollRatios();

        const page = await pdf.getPage(p);
        const rot = (page.rotate === 180) ? 0 : page.rotate;
        const baseVP = page.getViewport({ scale: 1, rotation: rot });

        const availW = Math.max(200, dom.previewBody.clientWidth - 24);
        const availH = Math.max(200, dom.previewBody.clientHeight - 24);

        const fitWidthScale = availW / baseVP.width;
        const fitPageScale  = Math.min(availW / baseVP.width, availH / baseVP.height);

        const fitMode = dom.fitMode?.value || "width";
        const fit = (fitMode === "page") ? fitPageScale : fitWidthScale;

        const scale = fit * zoom;
        const vp = page.getViewport({ scale, rotation: rot });

        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        canvas.style.width = `${Math.floor(vp.width)}px`;
        canvas.style.height = `${Math.floor(vp.height)}px`;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        currentRenderTask = page.render({ canvasContext: ctx, viewport: vp });

        try {
          await currentRenderTask.promise;
        } catch (e) {
          if (!(e && (e.name === "RenderingCancelledException" || /cancel/i.test(e.message || "")))) {
            throw e;
          }
        } finally {
          if (myToken === renderToken) currentRenderTask = null;
        }

        if (myToken !== renderToken) continue;

        if (dom.previewPage) dom.previewPage.textContent = `Page ${p}/${pdf.numPages}`;

        requestAnimationFrame(() => {
          if (dom.lockPos?.checked) restoreScrollFromRatios(lockedScroll);
          else applyAnchorAfterRender();
        });
      }
    } finally {
      renderInProgress = false;
    }
  }

  // Queue render: avoids spamming renders on rapid updates
  let renderQueued = false;
  let renderQueuedPage = 1;

  function queueRender(pageNum) {
    renderQueuedPage = pageNum;
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(async () => {
      try { await renderPDFPage(renderQueuedPage); }
      finally { renderQueued = false; }
    });
  }

  // --- Controls wiring ---
  function setCollapsed(on) {
    document.body.classList.toggle("preview-collapsed", !!on);
    if (dom.togglePreview) dom.togglePreview.textContent = on ? "Show preview" : "Hide preview";
    saveUI(dom);
  }

  dom.togglePreview?.addEventListener("click", () => {
    setCollapsed(!document.body.classList.contains("preview-collapsed"));
  });

  dom.fitMode?.addEventListener("change", () => { saveUI(dom); queueRender(dom._currentPage || 1); });
  dom.anchor?.addEventListener("change", () => { saveUI(dom); if (!dom.lockPos?.checked) applyAnchorAfterRender(); });
  dom.lockPos?.addEventListener("change", () => { if (dom.lockPos.checked) lockedScroll = getScrollRatios(); saveUI(dom); });

  // Slider zoom
  dom.zoom?.addEventListener("input", () => {
    zoom = clamp(Number(dom.zoom.value) / 100, 0.7, 2.5);
    if (dom.zoomVal) dom.zoomVal.textContent = `${zoom.toFixed(2)}×`;
    saveUI(dom);
    queueRender(dom._currentPage || 1);
  });

  // Ctrl+wheel zoom (PDF only)
  dom.previewBody?.addEventListener("wheel", (e) => {
    const pdf = getPdf();
    if (!pdf || isCollapsed()) return;
    if (!e.ctrlKey) return;
    e.preventDefault();

    const delta = -e.deltaY;
    const step = (Math.abs(delta) > 50) ? 0.08 : 0.04;
    zoom = clamp(zoom + (delta > 0 ? step : -step), 0.7, 2.5);

    if (dom.zoom) dom.zoom.value = String(Math.round(zoom * 100));
    if (dom.zoomVal) dom.zoomVal.textContent = `${zoom.toFixed(2)}×`;

    saveUI(dom);
    queueRender(dom._currentPage || 1);
  }, { passive: false });

  // Drag to pan
  let dragging = false, startX = 0, startY = 0, startSL = 0, startST = 0;
  dom.previewBody?.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    dom.previewBody.classList.add("dragging");
    startX = e.clientX; startY = e.clientY;
    startSL = dom.previewBody.scrollLeft;
    startST = dom.previewBody.scrollTop;
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    dom.previewBody.scrollLeft = startSL - (e.clientX - startX);
    dom.previewBody.scrollTop  = startST - (e.clientY - startY);
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
    dom.previewBody?.classList.remove("dragging");
  });

  // Double click/tap reset view
  async function resetView() {
    if (dom.fitMode) dom.fitMode.value = "page";
    if (dom.anchor) dom.anchor.value = "center";
    zoom = 1.0;
    if (dom.zoom) dom.zoom.value = "100";
    if (dom.zoomVal) dom.zoomVal.textContent = `1.00×`;
    saveUI(dom);
    queueRender(dom._currentPage || 1);
  }

  let lastTap = 0;
  dom.previewBody?.addEventListener("dblclick", (e) => { e.preventDefault(); resetView(); });
  dom.previewBody?.addEventListener("touchend", () => {
    const now = Date.now();
    if (now - lastTap < 300) resetView();
    lastTap = now;
  }, { passive: true });

  // Public API
  return {
    setCurrentPage(p) { dom._currentPage = p; },
    queueRender,
    setCollapsed,
    setZoomFromUI() {
      zoom = clamp(Number(dom.zoom?.value || 120) / 100, 0.7, 2.5);
      if (dom.zoomVal) dom.zoomVal.textContent = `${zoom.toFixed(2)}×`;
    }
  };
}