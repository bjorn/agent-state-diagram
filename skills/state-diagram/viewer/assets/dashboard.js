/* The server embeds the canonical Markdown; the pinned local Mermaid renders it. */
(async () => {
  // Diagram gestures: begin (also exercised directly by the focused unit tests).
  const gestureOwners = new WeakMap();

  function wheelWidth(current, natural, delta, mode = 0, page = 800) {
    if (![current, natural, delta].every(Number.isFinite) || current <= 0 || natural <= 0) return current;
    const pixels = delta * (mode === 1 ? 16 : mode === 2 ? page : 1);
    const factor = Math.exp(-Math.max(-240, Math.min(240, pixels)) * 0.0015);
    // Fit may legitimately start outside the manual 10%–400% range.
    const lower = Math.min(current, natural * 0.1);
    const upper = Math.max(current, natural * 4);
    return Math.max(lower, Math.min(upper, current * factor));
  }

  function attachDiagramGestures({viewport, fit, isReady = () => true}) {
    gestureOwners.get(viewport)?.destroy();
    const doc = viewport.ownerDocument;
    const win = doc.defaultView;
    const root = doc.scrollingElement;
    const listeners = [];
    const centered = {x: false, y: false};
    let manualWidth = null, drag = null, destroyed = false;
    const svg = () => viewport.querySelector("#diagram > svg");
    const naturalWidth = s => {
      const w = Number(s.getAttribute("viewBox")?.trim().split(/\s+/)[2]);
      return Number.isFinite(w) && w > 0 ? Math.max(320, w) : 1000;
    };
    const scroll = () => ({x: viewport.scrollLeft, y: root.scrollTop});
    const pan = (x, y) => {
      viewport.scrollLeft = centered.x ? 0 : viewport.scrollLeft + x;
      root.scrollTop = centered.y ? 0 : root.scrollTop + y;
    };
    function layout() {
      const s = svg();
      if (!s) return;
      const diagram = s.parentElement;
      const padding = win.getComputedStyle(viewport);
      const availableX = diagram.getBoundingClientRect().width;
      const availableY = Math.max(0, win.innerHeight -
        (doc.querySelector("header")?.getBoundingClientRect().height || 0) -
        parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom) -
        (viewport.offsetHeight - viewport.clientHeight));
      const bounds = s.getBoundingClientRect();
      // Each non-overflowing axis has one presentation position: its center.
      // Overflowing axes retain native scrolling and cursor anchoring.
      centered.x = bounds.width <= availableX + 0.5;
      centered.y = bounds.height <= availableY + 0.5;
      diagram.style.minHeight = `${availableY}px`;
      s.style.marginLeft = `${Math.max(0, (availableX - bounds.width) / 2)}px`;
      s.style.marginTop = `${Math.max(0, (availableY - bounds.height) / 2)}px`;
      if (centered.x) viewport.scrollLeft = 0;
      if (centered.y) root.scrollTop = 0;
    }
    const interactive = "a,button,input,select,textarea,label,[role=button],[role=link],[role=switch],[contenteditable]:not([contenteditable=false])";
    function eligible(event) {
      const s = svg(), target = event.target;
      return !destroyed && s && isReady(s) && s.contains(target) &&
        !target.closest?.(interactive) && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey ? s : null;
    }
    function listen(target, type, fn, options) {
      target.addEventListener(type, fn, options);
      listeners.push(() => target.removeEventListener(type, fn, options));
    }
    function cancel() {
      const previous = drag;
      drag = null;
      delete viewport.dataset.diagramPanning;
      if (previous && viewport.hasPointerCapture(previous.id)) viewport.releasePointerCapture(previous.id);
    }
    function refresh(saved) {
      cancel();
      const s = svg();
      if (s) s.parentElement.style.setProperty("--diagram-width", `${manualWidth ?? naturalWidth(s)}px`);
      layout();
      if (saved) {
        viewport.scrollLeft = centered.x ? 0 : saved.x;
        root.scrollTop = centered.y ? 0 : saved.y;
      }
    }
    function wheel(event) {
      const s = eligible(event);
      if (!s || !event.deltaY) return;
      event.preventDefault(); // Reaching a zoom bound must not scroll the page.
      const before = s.getBoundingClientRect();
      const next = wheelWidth(before.width, naturalWidth(s), event.deltaY, event.deltaMode, win.innerHeight);
      if (Math.abs(next - before.width) < 0.001) return;
      cancel();
      const u = (event.clientX - before.left) / before.width;
      const v = (event.clientY - before.top) / before.height;
      manualWidth = next;
      fit.checked = false;
      s.parentElement.style.setProperty("--diagram-width", `${next}px`);
      layout();
      const after = s.getBoundingClientRect();
      // Reuse native scrolling, with natural content-edge clamps, not transforms.
      pan(after.left + u * after.width - event.clientX,
        after.top + v * after.height - event.clientY);
    }
    function down(event) {
      if (drag || !eligible(event) || !event.isPrimary || event.button !== 0 ||
          (event.pointerType && event.pointerType !== "mouse")) return;
      try { viewport.setPointerCapture(event.pointerId); } catch { return; }
      event.preventDefault();
      drag = {id: event.pointerId, x: event.clientX, y: event.clientY};
      viewport.dataset.diagramPanning = "";
    }
    function move(event) {
      if (!drag || event.pointerId !== drag.id) return;
      if (!(event.buttons & 1) || !viewport.hasPointerCapture(drag.id) ||
          !svg() || !isReady(svg())) { cancel(); return; }
      event.preventDefault();
      pan(drag.x - event.clientX, drag.y - event.clientY);
      drag.x = event.clientX;
      drag.y = event.clientY;
    }
    function end(event) { if (drag?.id === event.pointerId) cancel(); }
    listen(viewport, "wheel", wheel, {passive: false});
    listen(viewport, "pointerdown", down);
    listen(viewport, "pointermove", move);
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) listen(viewport, type, end);
    // Capture can be revoked before the first gotpointercapture is delivered.
    for (const type of ["pointerup", "pointercancel"]) listen(win, type, end);
    listen(win, "blur", cancel);
    listen(win, "resize", layout);
    const header = doc.querySelector("header");
    const headerObserver = new win.ResizeObserver(layout);
    if (header) headerObserver.observe(header);
    listen(win, "keydown", event => { if (drag && event.key === "Escape") { cancel(); event.preventDefault(); } });
    listen(fit, "change", () => { manualWidth = null; refresh(); });
    const api = {
      beforeRender: scroll,
      afterRender: refresh,
      cancel,
      destroy() {
        if (destroyed) return;
        cancel();
        destroyed = true;
        for (const remove of listeners) remove();
        headerObserver.disconnect();
        if (gestureOwners.get(viewport) === api) gestureOwners.delete(viewport);
      },
    };
    listen(win, "pagehide", event => {
      if (event.persisted) cancel(); // Back/forward cache resumes this controller.
      else api.destroy();
    });
    gestureOwners.set(viewport, api);
    return api;
  }
  // Diagram gestures: end.

  const lastRefresh = document.querySelector("#last-refresh");
  const renderError = document.querySelector("#render-error");
  const themeToggle = document.querySelector("#theme");
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  let preference;
  try { preference = localStorage.getItem("state-view-theme"); } catch { /* Storage may be disabled. */ }
  if (!["light", "dark"].includes(preference)) preference = undefined;
  let theme = preference || (systemTheme.matches ? "dark" : "light");
  let requestRender = () => {};
  function applyTheme() {
    document.documentElement.dataset.theme = theme;
    if (themeToggle) themeToggle.checked = theme === "dark";
  }
  applyTheme();
  themeToggle?.addEventListener("change", () => {
    theme = themeToggle.checked ? "dark" : "light";
    preference = theme;
    try { localStorage.setItem("state-view-theme", theme); } catch { /* Keep the in-page choice. */ }
    applyTheme();
    requestRender();
  });
  systemTheme.addEventListener("change", event => {
    if (preference) return;
    theme = event.matches ? "dark" : "light";
    applyTheme();
    requestRender();
  });
  // Long-poll the server and reload once the canonical bytes change.
  async function watchSource(current) {
    for (;;) {
      try {
        const response = await fetch(`/wait?sha256=${current}`, {cache: "no-store"});
        if (!response.ok) throw new Error(response.statusText);
        if ((await response.text()) !== current) return location.reload();
      } catch {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Server restarting: retry.
      }
    }
  }
  const source = document.querySelector("#source");
  const digest = document.querySelector('meta[name="state-source-sha256"]').content;
  watchSource(digest);
  // The page reloads on every edit, so keep this choice for the tab's session.
  const viewSource = document.querySelector("#view-source");
  try { viewSource.checked = sessionStorage.getItem("state-view-source") === "on"; } catch { /* Storage may be disabled. */ }
  viewSource.addEventListener("change", () => {
    try { sessionStorage.setItem("state-view-source", viewSource.checked ? "on" : "off"); } catch { /* Keep the in-page choice. */ }
  });
  try {
    const blocks = [...source.textContent.matchAll(/^```mermaid[ \t]*\n([\s\S]*?)^```[ \t]*$/gm)];
    if (blocks.length !== 1) throw new Error("Expected one Mermaid fence");
    const code = blocks[0][1];
    const gestures = attachDiagramGestures({
      viewport: document.querySelector("main"), fit: document.querySelector("#fit"),
      isReady: svg => document.body.dataset.sourceSha256 === digest && svg.dataset.sourceSha256 === digest,
    });
    viewSource.addEventListener("change", () => gestures.afterRender()); // Re-center the shown diagram.
    let requested = 0;
    let completed = 0;
    let busy = false;
    requestRender = async () => {
      requested++;
      if (busy) return;
      busy = true;
      try {
        while (completed !== requested) {
          const revision = requested;
          const renderedTheme = theme;
          delete document.body.dataset.sourceSha256;
          delete document.body.dataset.renderError;
          renderError.hidden = true;
          renderError.textContent = "";
          try {
            mermaid.initialize({
              startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true,
              theme: renderedTheme === "dark" ? "dark" : "default",
              fontFamily: "system-ui, sans-serif",
              themeVariables: {
                fontFamily: "system-ui, sans-serif",
                ...(renderedTheme === "dark" ? {
                  background: "#161b22", primaryColor: "#21262d", primaryTextColor: "#e6edf3",
                  primaryBorderColor: "#8b949e", lineColor: "#adb8c4", textColor: "#e6edf3",
                  mainBkg: "#21262d", nodeBorder: "#8b949e",
                  clusterBkg: "#21262d", clusterBorder: "#8b949e",
                  edgeLabelBackground: "#161b22",
                  dropShadow: "drop-shadow(1px 2px 2px rgba(0, 0, 0, 0.45))",
                } : {}),
              },
              flowchart: {useMaxWidth: false, wrappingWidth: 290},
            });
            // A unique ID keeps Mermaid from removing the last-good SVG mid-render.
            const rendered = await mermaid.render(`state-diagram-svg-${revision}`, code);
            if (revision !== requested) continue;
            const diagram = document.createElement("div");
            diagram.id = "diagram";
            diagram.innerHTML = rendered.svg;
            const svg = diagram.querySelector("svg");
            if (!svg) throw new Error("Mermaid produced no SVG");
            if (renderedTheme === "dark") {
              // Mermaid 12 emits classDef fill/stroke as inline !important.
              // Remove only those two rendered declarations so scoped CSS can
              // supply the dark status palette, retaining dashes/shape/width.
              for (const shape of svg.querySelectorAll(".node:is(.pending, .running, .waiting, .blocked, .done) :is(rect, polygon, path, circle, ellipse)")) {
                shape.style.removeProperty("fill");
                shape.style.removeProperty("stroke");
              }
            }
            const width = Number(svg.getAttribute("viewBox")?.split(/\s+/)[2]);
            diagram.style.setProperty("--diagram-width", `${Number.isFinite(width) ? Math.max(320, width) : 1000}px`);
            svg.style.maxWidth = "none";
            svg.dataset.sourceSha256 = digest;
            svg.dataset.theme = renderedTheme;
            const scroll = gestures.beforeRender();
            const previous = document.querySelector("#diagram");
            if (previous) previous.replaceWith(diagram);
            else source.before(diagram); // Keep the source for View source and failed renders.
            gestures.afterRender(scroll);
            delete document.body.dataset.renderError;
            document.body.dataset.sourceSha256 = digest;
            document.body.dataset.renderTheme = renderedTheme;
            const refreshedAt = new Date();
            lastRefresh.dateTime = refreshedAt.toISOString();
            lastRefresh.textContent = refreshedAt.toLocaleString();
          } catch (error) {
            if (revision !== requested) continue;
            renderError.textContent = `Render failed: ${error.message}`;
            renderError.hidden = false;
            document.body.dataset.renderError = error.message;
          }
          completed = revision;
        }
      } finally {
        busy = false;
      }
    };
    await requestRender();
  } catch (error) {
    renderError.textContent = `Render failed: ${error.message}`;
    renderError.hidden = false;
    document.body.dataset.renderError = error.message;
    // The readable canonical source remains on failure.
  }
})();
