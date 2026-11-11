// Serverless Chromium fixtures; stub SVGs and pinned local Mermaid, never a live service.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {createHash} from "node:crypto";
import {fileURLToPath, pathToFileURL} from "node:url";
import {before, after, test} from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifacts = process.env.STATE_DIAGRAM_TEST_ARTIFACTS || os.tmpdir();
const origin = "http://127.0.0.1:16919";
assert(process.env.STATE_DIAGRAM_MERMAID, "Set STATE_DIAGRAM_MERMAID to an existing pinned bundle");
const template = await fs.readFile(path.join(here, "../assets/templates/index.html"), "utf8");
const controller = await fs.readFile(path.join(here, "../assets/static/dashboard.js"), "utf8");
const vendor = await fs.readFile(process.env.STATE_DIAGRAM_MERMAID, "utf8");
const block = controller.match(/\/\/ Diagram gestures: begin[^\n]*\n([\s\S]*?)\/\/ Diagram gestures: end\./);
assert(block, "Exercise the actual controller helper, not a separate implementation");
const wheelWidth = vm.runInNewContext(`${block[1]}\nwheelWidth;`);
// Only fixture responses expose teardown/remount hooks; the served controller does not.
const instrumented = controller.replace("    let requested = 0;", `    window.gestureTest = gestures;
    window.remountGestures = () => attachDiagramGestures({
      viewport: document.querySelector("main"), fit: document.querySelector("#fit"),
      isReady: svg => document.body.dataset.sourceSha256 === digest && svg.dataset.sourceSha256 === digest,
    });
    let requested = 0;`);
assert.notEqual(instrumented, controller);
const code = `flowchart LR
 p["Pending"]:::pending --> r["Running"]:::running --> w["Waiting"]:::waiting --> b["Blocked"]:::blocked --> d["Done"]:::done
 classDef pending fill:#eeeeee,stroke:#6e7781
 classDef running fill:#cfe8ff,stroke:#1f6feb
 classDef waiting fill:#fff3c4,stroke:#bf8700
 classDef blocked fill:#ffd6d6,stroke:#cf222e
 classDef done fill:#dafbe1,stroke:#1a7f37
`;
const source = `# State\n\n\`\`\`mermaid\n${code}\`\`\`\n`;
const hash = b => createHash("sha256").update(b).digest("hex");
const digest = hash(source);
const html = template.replace(/\{%[\s\S]*?%\}/g, "")
  .replaceAll("{{ source_hash }}", digest)
  .replaceAll("{{ source | base64_encode }}", Buffer.from(source).toString("base64"))
  .replace("{{ source | markdown | safe }}", `<h1>State</h1><pre><code class="language-mermaid">${code}</code></pre>`)
  .replaceAll("{{ reload_hash }}", createHash("sha256").update("").digest("base64"))
  .replaceAll("{{ port }}", "16919");
const proof = [];
let browser;
before(async () => {
  let modulePath = process.env.PUPPETEER_MODULE;
  if (!modulePath) {
    for (const entry of await fs.readdir(path.join(os.homedir(), ".npm/_npx"))) {
      const root = path.join(os.homedir(), ".npm/_npx", entry, "node_modules/puppeteer");
      try {
        const metadata = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
        modulePath = path.resolve(root, metadata.main);
        await fs.access(modulePath);
        break;
      } catch { modulePath = undefined; }
    }
  }
  assert(modulePath, "Cached Puppeteer required; no download fallback");
  const {default: puppeteer} = await import(pathToFileURL(modulePath));
  browser = await puppeteer.launch({headless: true, pipe: true,
    args: ["--no-sandbox", "--disable-background-networking", "--disable-component-update", "--no-first-run"]});
});
after(async () => {
  await browser?.close();
  await fs.writeFile(path.join(artifacts, "state-diagram-gestures-fixtures.json"), JSON.stringify(proof, null, 2));
});
const ready = (page, theme) => page.waitForFunction(t => {
  const s = document.querySelector("#diagram > svg");
  return document.body.dataset.sourceSha256 && s?.dataset.sourceSha256 === document.body.dataset.sourceSha256 &&
    (!t || s.dataset.theme === t) && !document.body.dataset.renderError;
}, {timeout: 15000}, theme);
const view = page => page.evaluate(() => {
  const s = document.querySelector("#diagram > svg"), r = s.getBoundingClientRect();
  return {width: r.width, height: r.height, available: document.querySelector("#diagram").getBoundingClientRect().width,
    fit: document.querySelector("#fit").checked, x: document.querySelector("main").scrollLeft,
    y: document.scrollingElement.scrollTop, panning: document.querySelector("main").hasAttribute("data-diagram-panning"),
    bodyHash: document.body.dataset.sourceSha256, svgHash: s.dataset.sourceSha256,
    stamp: document.querySelector("#last-refresh").dateTime};
});
async function pageFor({width = 2400, height = 2400, real = false,
  osTheme = "light", preference, viewportWidth = 1000} = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const evidence = {errors: [], external: [], responses: []};
  page.on("pageerror", e => evidence.errors.push(String(e)));
  await page.setViewport({width: viewportWidth, height: 700, deviceScaleFactor: 1});
  await page.emulateMediaFeatures([{name: "prefers-color-scheme", value: osTheme}]);
  await page.evaluateOnNewDocument(choice => {
    if (choice) localStorage.setItem("state-view-theme", choice);
    window.lastPointer = null;
    document.addEventListener("pointerdown", e => { window.lastPointer = e.pointerId; }, true);
  }, preference);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="#223344"/>
    <a href="#node-link"><text x="30" y="100" fill="white">normal link</text></a>
    <foreignObject x="30" y="150" width="200" height="50"><div xmlns="http://www.w3.org/1999/xhtml"><input id="inside-control" value="normal input"/></div></foreignObject>
  </svg>`;
  const stub = `window.mermaid={initialize(){},async render(){return {svg:${JSON.stringify(svg)}}}};`;
  await page.setRequestInterception(true);
  page.on("request", r => {
    const url = r.url();
    if (new URL(url).origin !== origin) { evidence.external.push(url); r.abort(); }
    else if (url === origin + "/") r.respond({contentType: "text/html", body: html});
    else if (url === origin + "/dashboard.js") r.respond({contentType: "text/javascript", body: instrumented});
    else if (url === origin + "/mermaid-12.3.0.min.js") r.respond({contentType: "text/javascript", body: real ? vendor : stub});
    else if (url === origin + "/favicon.ico") r.respond({status: 204});
    else { evidence.errors.push(`Unexpected request: ${url}`); r.abort(); }
  });
  await page.goto(origin, {waitUntil: "load"});
  await ready(page);
  return {context, page, evidence};
}
async function fixture(run, options) {
  const {context, page, evidence} = await pageFor(options);
  try {
    await run(page);
    assert.deepEqual(evidence.errors, []);
    assert.deepEqual(evidence.external, []);
  } finally { await context.close(); }
}
async function zoom(page, x = 400, y = 350, delta = -120) {
  const old = await view(page);
  await page.mouse.move(x, y);
  await page.mouse.wheel({deltaY: delta});
  await page.waitForFunction(w => Math.abs(document.querySelector("#diagram > svg").getBoundingClientRect().width - w) > 0.5, {}, old.width);
  return view(page);
}
async function startDrag(page, x = 400, y = 350) {
  await page.mouse.move(x, y);
  await page.mouse.down({button: "left"});
  assert.equal((await view(page)).panning, true);
}
async function listenerTypes(cdp, expression) {
  const {result} = await cdp.send("Runtime.evaluate", {expression});
  const {listeners} = await cdp.send("DOMDebugger.getEventListeners", {objectId: result.objectId});
  return listeners.map(l => l.type).sort();
}
test("wheel direction, inverse steps and delta units", () => {
  const up = wheelWidth(1000, 1000, -100);
  assert(up > 1000);
  assert(Math.abs(wheelWidth(up, 1000, 100) - 1000) < 1e-9);
  assert.equal(wheelWidth(1000, 1000, -2, 1), wheelWidth(1000, 1000, -32));
  assert.equal(wheelWidth(1000, 1000, -0.1, 2, 800), wheelWidth(1000, 1000, -80));
});
test("manual bounds and bounded wheel steps", () => {
  assert.equal(wheelWidth(4000, 1000, -100), 4000);
  assert.equal(wheelWidth(100, 1000, 100), 100);
  assert(wheelWidth(1000, 1000, -1e6) < 1500);
});
test("Fit below the minimum does not jump", () => {
  const next = wheelWidth(500, 50000, -10);
  assert(next > 500 && next < 510);
  assert.equal(wheelWidth(500, 50000, 10), 500);
});
test("Fit above the maximum eases inward", () => {
  const next = wheelWidth(2000, 320, 10);
  assert(next < 2000 && next > 1950);
  assert.equal(wheelWidth(2000, 320, -10), 2000);
});
test("zero and nonfinite input cannot fabricate zoom", () => {
  for (const delta of [0, NaN, Infinity]) assert.equal(wheelWidth(1000, 1000, delta), 1000);
  assert.equal(wheelWidth(1000, 0, -50), 1000);
});
test("cursor anchoring, manual sizing, rerender, resize, keyboard Fit and stable refresh", async () => {
  await fixture(async page => {
    const before = await view(page);
    const point = await page.evaluate(() => new DOMPoint(400, 350).matrixTransform(document.querySelector("#diagram > svg").getScreenCTM().inverse()).toJSON());
    const manual = await zoom(page);
    const anchored = await page.evaluate(p => new DOMPoint(p.x, p.y).matrixTransform(document.querySelector("#diagram > svg").getScreenCTM()).toJSON(), point);
    assert(Math.abs(anchored.x - 400) < 1.5 && Math.abs(anchored.y - 350) < 1.5, JSON.stringify(anchored));
    assert(!manual.fit && manual.stamp === before.stamp && manual.bodyHash === before.bodyHash);
    await page.click("#theme"); await ready(page, "dark");
    assert(Math.abs((await view(page)).width - manual.width) < 0.1);
    await page.setViewport({width: 1200, height: 700});
    assert(Math.abs((await view(page)).width - manual.width) < 0.1);
    await page.focus("#fit"); await page.keyboard.press("Space");
    const fitted = await view(page);
    assert(fitted.fit && Math.abs(fitted.width - fitted.available) < 1);
    assert.equal(fitted.bodyHash, digest);
    proof.push({case: "anchor/fit/theme/refresh", before, manual, anchored, fitted});
  });
});
test("left capture drag pans both axes without selection or exiting Fit", async () => {
  await fixture(async page => {
    await zoom(page);
    const before = await view(page);
    await startDrag(page); await page.mouse.move(320, 300);
    const after = await view(page);
    assert(Math.abs(after.x - before.x - 80) < 1.1 && Math.abs(after.y - before.y - 50) < 1.1);
    assert.equal(after.stamp, before.stamp);
    const state = await page.evaluate(() => ({
      capture: document.querySelector("main").hasPointerCapture(window.lastPointer),
      cursor: getComputedStyle(document.querySelector("#diagram rect")).cursor, selection: getSelection().toString(),
    }));
    assert(state.capture && state.cursor === "grabbing" && state.selection === "");
    await page.mouse.move(1050, 300);
    assert((await view(page)).panning);
    await page.mouse.up();
    assert.equal((await view(page)).panning, false);
    await page.focus("#fit"); await page.keyboard.press("Space");
    await startDrag(page); await page.mouse.move(400, 310);
    assert.equal((await view(page)).fit, true);
    await page.mouse.up();
    proof.push({case: "drag/capture", before, after, state});
  });
});
test("controls, links, non-diagram wheel, modifiers, touch and non-left pointers are native", async () => {
  await fixture(async page => {
    const before = await view(page);
    const result = await page.evaluate(() => {
      const wheel = ["#fit", "#theme", "header", "#diagram a", "#inside-control"].map(selector => {
        const e = new WheelEvent("wheel", {bubbles: true, cancelable: true, deltaY: -100});
        document.querySelector(selector).dispatchEvent(e); return e.defaultPrevented;
      });
      for (const opts of [{button: 1}, {button: 2}, {button: 0, pointerType: "touch"}, {button: 0, isPrimary: false}]) {
        document.querySelector("#diagram rect").dispatchEvent(new PointerEvent("pointerdown",
          {bubbles: true, cancelable: true, pointerId: 8, pointerType: "mouse", isPrimary: true, ...opts}));
      }
      const ctrl = new WheelEvent("wheel", {bubbles: true, cancelable: true, deltaY: -100, ctrlKey: true});
      document.querySelector("#diagram rect").dispatchEvent(ctrl);
      return {wheel, ctrl: ctrl.defaultPrevented};
    });
    assert.deepEqual(result.wheel, [false, false, false, false, false]);
    assert.equal(result.ctrl, false);
    assert.deepEqual(await view(page), before);
    await page.click("#diagram a"); assert.equal(new URL(page.url()).hash, "#node-link");
    proof.push({case: "exclusions", result});
  });
});
test("cancel, lost capture, Escape, blur, bfcache and rerender clean up drag", async () => {
  await fixture(async page => {
    await zoom(page);
    for (const mode of ["cancel", "lost", "escape", "blur", "bfcache", "rerender"]) {
      await startDrag(page);
      if (mode === "escape") await page.keyboard.press("Escape");
      else if (mode === "rerender") {
        await page.evaluate(() => document.querySelector("#theme").click()); await ready(page, "dark");
      } else await page.evaluate(mode => {
        const main = document.querySelector("main");
        if (mode === "cancel") main.dispatchEvent(new PointerEvent("pointercancel", {bubbles: true, pointerId: window.lastPointer}));
        if (mode === "lost") main.releasePointerCapture(window.lastPointer);
        if (mode === "blur") window.dispatchEvent(new Event("blur"));
        if (mode === "bfcache") window.dispatchEvent(new PageTransitionEvent("pagehide", {persisted: true}));
      }, mode);
      await page.mouse.move(399, 349);
      assert.equal((await view(page)).panning, false, mode);
      assert.equal(await page.evaluate(() => document.querySelector("main").hasPointerCapture(window.lastPointer)), false);
      const stopped = await view(page);
      await page.mouse.move(380, 330); assert.deepEqual(await view(page), stopped);
      await page.mouse.up();
    }
    proof.push({case: "cancel/lost/escape/blur/bfcache/rerender", pass: true});
  });
});
test("unload/destroy removes listeners and remount cannot duplicate them", async () => {
  await fixture(async page => {
    const cdp = await page.createCDPSession();
    const expression = 'document.querySelector("main")';
    const before = await listenerTypes(cdp, expression);
    assert(before.includes("wheel") && before.includes("pointercancel"));
    await startDrag(page);
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide", {persisted: false}));
      window.gestureTest.destroy(); window.gestureTest.destroy();
    });
    assert.equal((await view(page)).panning, false);
    await page.mouse.up();
    assert.deepEqual(await listenerTypes(cdp, expression), []);
    assert.deepEqual(await listenerTypes(cdp, 'document.querySelector("#fit")'), []);
    for (const t of ["blur", "resize", "keydown", "pagehide", "pointerup", "pointercancel"]) assert(!(await listenerTypes(cdp, "window")).includes(t));
    await page.evaluate(() => { window.remountGestures(); window.gestureTest = window.remountGestures(); });
    assert.deepEqual(await listenerTypes(cdp, expression), before);
    await cdp.detach();
    proof.push({case: "listener cleanup/remount", before});
  });
});
test("Fit outside bounds zooms gradually and blocked wheel cannot scroll the page", async () => {
  for (const opts of [{width: 50000, height: 50000}, {width: 320, height: 320, viewportWidth: 2200}]) {
    await fixture(async page => {
      const before = await view(page);
      assert.equal(await page.evaluate(delta => {
        const e = new WheelEvent("wheel", {bubbles: true, cancelable: true, deltaY: delta, clientX: 400, clientY: 350});
        document.querySelector("#diagram rect").dispatchEvent(e); return e.defaultPrevented;
      }, opts.width === 50000 ? 10 : -10), true);
      assert.deepEqual(await view(page), before);
      const after = await zoom(page, 400, 350, opts.width === 50000 ? -10 : 10);
      assert(Math.abs(after.width - before.width) / before.width < 0.02);
      proof.push({case: "Fit outside bounds", natural: opts.width, before, after});
    }, opts);
  }
});
test("real Mermaid keeps persisted/OS theme, palette and readiness", async () => {
  await fixture(async page => {
    await ready(page, "dark");
    const colors = () => page.evaluate(() => [...document.querySelectorAll("#diagram .node")].map(n => {
      const s = getComputedStyle(n.querySelector("rect,polygon,path,circle")); return [n.getAttribute("class"), s.fill, s.stroke];
    }));
    const before = await colors();
    const point = await diagramPoint(page);
    await zoom(page, point.x, point.y);
    assert.deepEqual(await colors(), before);
    await page.click("#theme"); await ready(page, "light");
    await page.click("#theme"); await ready(page, "dark");
    assert.deepEqual(await colors(), before);
    assert.equal((await view(page)).bodyHash, digest);
  }, {real: true, preference: "dark"});
  await fixture(async page => {
    await ready(page, "dark");
    await page.emulateMediaFeatures([{name: "prefers-color-scheme", value: "light"}]); await ready(page, "light");
  }, {real: true, osTheme: "dark"});
});

async function diagramPoint(page) {
  return page.$eval("#diagram > svg", e => {
    const r = e.getBoundingClientRect();
    return {x: Math.max(r.left + 2, Math.min(400, r.right - 2)),
      y: Math.max(r.top + 2, Math.min(350, r.bottom - 2))};
  });
}
async function centering(page) {
  await page.evaluate(() => new Promise(requestAnimationFrame));
  return page.evaluate(() => {
    const main = document.querySelector("main"), r = document.querySelector("#diagram > svg").getBoundingClientRect();
    const p = getComputedStyle(main), m = main.getBoundingClientRect();
    const left = m.left + parseFloat(p.paddingLeft), right = m.right - parseFloat(p.paddingRight);
    const top = document.querySelector("header").getBoundingClientRect().bottom + parseFloat(p.paddingTop);
    const bottom = innerHeight - parseFloat(p.paddingBottom) - (main.offsetHeight - main.clientHeight);
    return {smallX: r.width <= right - left + 0.5, smallY: r.height <= bottom - top + 0.5,
      dx: (r.left + r.right - left - right) / 2, dy: (r.top + r.bottom - top - bottom) / 2,
      x: main.scrollLeft, y: document.scrollingElement.scrollTop, width: r.width};
  });
}
async function assertCentered(page) {
  const c = await centering(page);
  if (c.smallX) assert(Math.abs(c.dx) < 1.5 && c.x === 0, JSON.stringify(c));
  if (c.smallY) assert(Math.abs(c.dy) < 1.5 && c.y === 0, JSON.stringify(c));
  return c;
}
test("both small axes stay centered through zoom, drag, resize and dark rerender", async () => {
  await fixture(async page => {
    await page.focus("#fit"); await page.keyboard.press("Space");
    const initial = await view(page), c = await assertCentered(page);
    assert(c.smallX && c.smallY);
    const point = await diagramPoint(page);
    await startDrag(page, point.x, point.y);
    await page.mouse.move(point.x - 80, point.y - 40); await page.mouse.up();
    await assertCentered(page);
    assert.equal((await view(page)).stamp, initial.stamp);
    await page.setViewport({width: 500, height: 220});
    const overflowing = await centering(page);
    assert(!overflowing.smallX && !overflowing.smallY);
    await page.setViewport({width: 1200, height: 900});
    await assertCentered(page);
    assert.equal((await view(page)).stamp, initial.stamp);
    await page.click("#theme"); await ready(page, "dark");
    const dark = await assertCentered(page);
    assert(dark.smallX && dark.smallY && Math.abs(dark.width - initial.width) < 0.1);
    assert.equal((await view(page)).bodyHash, initial.bodyHash);
    proof.push({case: "small both/resize/dark", initial: c, overflowing, dark});
  }, {width: 600, height: 220});
});
test("each small axis stays centered while the other axis pans", async () => {
  for (const opts of [{width: 2400, height: 200}, {width: 320, height: 1800}]) {
    await fixture(async page => {
      await page.focus("#fit"); await page.keyboard.press("Space");
      const before = await assertCentered(page);
      assert.notEqual(before.smallX, before.smallY);
      const p = await diagramPoint(page);
      await startDrag(page, p.x, p.y); await page.mouse.move(p.x - 80, p.y - 40);
      const after = await assertCentered(page);
      if (before.smallX) assert(after.y > before.y && after.x === 0);
      else assert(after.x > before.x && after.y === 0);
      await page.mouse.up();
      proof.push({case: "one small axis", before, after});
    }, opts);
  }
});
test("zoom crosses between centered and overflowing axes without a scale jump", async () => {
  await fixture(async page => {
    await page.focus("#fit"); await page.keyboard.press("Space");
    const widths = [];
    for (const delta of [120, 120, 120, 120, -120, -120, -120, -120]) {
      const p = await diagramPoint(page), before = await view(page);
      const next = await zoom(page, p.x, p.y, delta);
      assert(Math.abs(next.width / before.width - Math.exp(-delta * .0015)) < .001);
      widths.push(await assertCentered(page));
    }
    assert(widths.some(c => c.smallX && c.smallY));
    assert(!widths.at(-1).smallX && !widths.at(-1).smallY);
    proof.push({case: "centering boundary", widths});
  }, {width: 1200, height: 1200});
});
