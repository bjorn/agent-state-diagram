// Serverless Chromium + pinned local Mermaid fixtures; no live-service access.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {after, before, test} from "node:test";
import {fileURLToPath} from "node:url";
import {launchBrowser} from "./browser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifacts = process.env.STATE_DIAGRAM_TEST_ARTIFACTS || os.tmpdir();
const origin = "http://127.0.0.1:16919";
assert(process.env.STATE_DIAGRAM_MERMAID, "Set STATE_DIAGRAM_MERMAID to an existing pinned bundle");
const template = await fs.readFile(path.join(here, "../assets/templates/index.html"), "utf8");
const dashboard = await fs.readFile(path.join(here, "../assets/static/dashboard.js"), "utf8");
const mermaid = await fs.readFile(process.env.STATE_DIAGRAM_MERMAID, "utf8");
const code = `%%{init: {"flowchart": {"wrappingWidth": 300}, "themeVariables": {"fontSize": "14px"}}}%%
flowchart LR
  p["Pending"]:::pending --> r[["Work<br>worker<br>running<br>report.md"]]:::running
  r -. waits on .-> w["Waiting"]:::waiting
  w ==> b["Blocked"]:::blocked
  b --> d["Done"]:::done
  classDef pending fill:#eeeeee,stroke:#6e7781
  classDef running fill:#cfe8ff,stroke:#1f6feb
  classDef waiting fill:#fff3c4,stroke:#bf8700
  classDef blocked fill:#ffd6d6,stroke:#cf222e
  classDef done fill:#dafbe1,stroke:#1a7f37
  classDef note stroke-dasharray:5 5
  class r note
`;
const source = `# State\n\n\`\`\`mermaid\n${code}\`\`\`\n`;
const digest = createHash("sha256").update(source).digest("hex");
const html = template.replace(/\{%[\s\S]*?%\}/g, "")
  .replaceAll("{{ source_hash }}", digest)
  .replaceAll("{{ source | base64_encode }}", Buffer.from(source).toString("base64"))
  .replaceAll('{{ source_hash | truncate(length=12, end="") }}', digest.slice(0, 12))
  .replace("{{ source | markdown | safe }}", `<h1>State</h1><pre><code class="language-mermaid">${code.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</code></pre>`)
  .replaceAll("{{ reload_hash }}", createHash("sha256").update("").digest("base64"))
  .replaceAll("{{ port }}", "16919");
let browser;

before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

async function pageFor({osTheme = "light", preference, storageBlocked = false} = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const evidence = {externalRequests: [], errors: []};
  page.on("pageerror", error => evidence.errors.push(String(error)));
  await page.setViewport({width: 1365, height: 900});
  await page.emulateMediaFeatures([{name: "prefers-color-scheme", value: osTheme}]);
  await page.evaluateOnNewDocument((choice, blocked) => {
    if (blocked) {
      Object.defineProperty(window, "localStorage", {get() { throw new Error("Storage disabled"); }});
    } else if (choice) {
      localStorage.setItem("state-view-theme", choice);
    }
  }, preference, storageBlocked);
  await page.setRequestInterception(true);
  page.on("request", request => {
    const url = request.url();
    if (new URL(url).origin !== origin) {
      evidence.externalRequests.push(url);
      request.abort();
    } else if (url === `${origin}/`) request.respond({contentType: "text/html", body: html});
    else if (url === `${origin}/dashboard.js`) request.respond({contentType: "text/javascript", body: dashboard});
    else if (url === `${origin}/mermaid-12.3.0.min.js`) request.respond({contentType: "text/javascript", body: mermaid});
    else if (url === `${origin}/favicon.ico`) request.respond({status: 204});
    else { evidence.errors.push(`Unexpected local request: ${url}`); request.abort(); }
  });
  await page.goto(origin, {waitUntil: "load"});
  return {page, context, evidence};
}

async function ready(page, theme) {
  await page.waitForFunction(expected => document.body.dataset.renderError ||
    (document.body.dataset.sourceSha256 &&
     document.querySelector("#diagram > svg")?.dataset.theme === expected &&
     document.body.dataset.renderTheme === expected), {timeout: 15000}, theme);
  const result = await page.evaluate(() => ({
    error: document.body.dataset.renderError,
    body: document.body.dataset.sourceSha256,
    expected: document.querySelector('meta[name="state-source-sha256"]').content,
    svg: document.querySelector("#diagram > svg")?.dataset.sourceSha256,
    themeChecked: document.querySelector("#theme").checked,
    fit: document.querySelector("#fit").checked,
    width: document.querySelector("#diagram > svg")?.getBoundingClientRect().width,
    available: document.querySelector("#diagram")?.getBoundingClientRect().width,
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
  }));
  assert.equal(result.error, undefined);
  assert.equal(result.body, result.expected);
  assert.equal(result.svg, result.expected);
  assert.equal(result.themeChecked, theme === "dark");
  assert.equal(result.colorScheme, theme);
  return result;
}

function luminance(color) {
  const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number)
    .map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}
async function palette(page) {
  return page.evaluate(() => {
    const colors = {};
    for (const state of ["pending", "running", "waiting", "blocked", "done"]) {
      const node = document.querySelector(`#diagram .node.${state}`);
      if (!node) continue;
      const shape = node.querySelector("rect, polygon, path, circle, ellipse");
      const label = node.querySelector(".nodeLabel");
      colors[state] = {fill: getComputedStyle(shape).fill, stroke: getComputedStyle(shape).stroke,
        text: getComputedStyle(label).color, dash: getComputedStyle(shape).strokeDasharray,
        strokeWidth: getComputedStyle(shape).strokeWidth};
    }
    const root = getComputedStyle(document.documentElement);
    return {nodes: colors, text: root.color, background: root.backgroundColor,
      chrome: getComputedStyle(document.querySelector("header")).backgroundColor,
      muted: getComputedStyle(document.querySelector("#status")).color};
  });
}
function assertReadable(colors) {
  assert.ok(contrast(colors.text, colors.background) >= 4.5);
  assert.ok(contrast(colors.muted, colors.chrome) >= 4.5);
  for (const [state, node] of Object.entries(colors.nodes)) {
    assert.ok(contrast(node.text, node.fill) >= 4.5, `${state}: ${JSON.stringify(node)}`);
  }
  assert.equal(new Set(Object.values(colors.nodes).map(node => node.fill)).size, Object.keys(colors.nodes).length);
}

async function shadowPaint(page) {
  const paint = await page.evaluate(() => ({
    filters: [...new Set([...document.querySelectorAll("#diagram > svg *")]
      .map(element => getComputedStyle(element).filter).filter(value => value !== "none"))],
    roots: ["html", "body", "main", "#diagram", "#diagram > svg"]
      .map(selector => getComputedStyle(document.querySelector(selector)).filter),
  }));
  assert(paint.filters.length > 0, "Retain real shadows, not filter: none");
  return paint;
}

async function outsideShadowPixels(page) {
  // At natural width / DPR 1, exclude corners and the 1px bright status border.
  const clip = await page.$eval("#diagram .node.pending rect", shape => {
    const box = shape.getBoundingClientRect();
    return {x: Math.ceil(box.left + scrollX) + 12, y: Math.ceil(box.bottom + scrollY) + 3,
      width: Math.floor(box.width) - 24, height: 5};
  });
  const colors = await palette(page);
  const shadow = await page.screenshot({clip});
  const disabled = await page.addStyleTag({content: "#diagram > svg * { filter: none !important; }"});
  let control;
  try {
    assert.deepEqual(await palette(page), colors, "Diagnostic control must not change borders/text/fills");
    control = await page.screenshot({clip});
  } finally {
    await disabled.evaluate(style => style.remove());
    await disabled.dispose();
  }
  return page.evaluate(async (shadowBytes, controlBytes) => {
    async function pixels(bytes) {
      const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], {type: "image/png"}));
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      image.close();
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    }
    // Decode in memory; no PNG dependency, image request, or golden screenshot.
    const [shadow, control] = await Promise.all([pixels(shadowBytes), pixels(controlBytes)]);
    let darker = 0, brighter = 0, total = 0;
    for (let i = 0; i < shadow.length; i += 4) {
      const delta = .2126 * (shadow[i] - control[i]) + .7152 * (shadow[i + 1] - control[i + 1]) +
        .0722 * (shadow[i + 2] - control[i + 2]);
      total += delta;
      if (delta < -.5) darker++;
      if (delta > .5) brighter++;
    }
    const samples = shadow.length / 4;
    return {samples, darker, brighter, meanDelta: total / samples};
  }, [...shadow], [...control]);
}

test("Dark shadows darken outside borders without halos; theme toggles stay readable", async () => {
  const {page, context, evidence} = await pageFor({osTheme: "dark"});
  try {
    await ready(page, "dark");
    await page.click("#fit");
    const paint = await shadowPaint(page);
    const colors = await palette(page);
    assertReadable(colors);
    const pixels = await outsideShadowPixels(page);
    assert(pixels.darker > pixels.samples * .25, JSON.stringify(pixels));
    assert(pixels.brighter <= pixels.samples * .01, JSON.stringify(pixels));
    assert(pixels.meanDelta < -.2, JSON.stringify(pixels));
    await fs.writeFile(path.join(artifacts, "state-diagram-shadow-controls-pixels.json"),
      JSON.stringify({paint, colors, outsideBorderPixels: pixels}, null, 2) + "\n");
    await shadowPaint(page);
    await page.click("#theme");
    assert.equal((await ready(page, "light")).fit, false);
    await shadowPaint(page);
    assertReadable(await palette(page));
    await page.click("#theme");
    assert.equal((await ready(page, "dark")).fit, false);
    await shadowPaint(page);
    assert.deepEqual(evidence.externalRequests, []);
    assert.deepEqual(evidence.errors, []);
  } finally { await context.close(); }
});

test("Matched named switches expose checked state, keyboard focus and persistent theme choice", async () => {
  const {page, context} = await pageFor();
  try {
    await ready(page, "light");
    for (const width of [1280, 375]) {
      await page.setViewport({width, height: 900});
      const layout = await page.$$eval(".toggle", labels => labels.map(label => ({
        text: label.innerText, height: label.getBoundingClientRect().height,
        labelRight: label.querySelector("span:not(.toggle-track)").getBoundingClientRect().right,
        trackLeft: label.querySelector(".toggle-track").getBoundingClientRect().left,
      })));
      assert.deepEqual(layout.map(e => e.text), ["Fit width", "Dark mode"]);
      assert(layout.every(e => e.labelRight < e.trackLeft && e.height >= 24), JSON.stringify(layout));
      assert(!/\bOn\b|\bOff\b/.test(await page.$eval("header", e => e.innerText)));
    }
    const cdp = await page.createCDPSession();
    async function states(fit, dark) {
      const tree = await cdp.send("Accessibility.getFullAXTree");
      for (const [name, checked] of [["Fit width", fit], ["Dark mode", dark]]) {
        const control = tree.nodes.find(node => node.role?.value === "switch" && node.name?.value === name);
        assert(control, `Named accessible switch: ${name}`);
        assert.equal(control.properties.find(property => property.name === "checked").value.value, String(checked));
      }
    }
    await states(true, false);
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.id), "fit");
    const focus = await page.$eval("#fit", input => {
      const style = getComputedStyle(input.closest("label"));
      return {visible: input.matches(":focus-visible"), width: style.outlineWidth,
        color: style.outlineColor, background: getComputedStyle(document.querySelector("header")).backgroundColor};
    });
    assert(focus.visible);
    assert(parseFloat(focus.width) > 0);
    assert(contrast(focus.color, focus.background) >= 3);
    await page.keyboard.press("Space");
    const manual = await ready(page, "light");
    assert.equal(manual.fit, false);
    await states(false, false);
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.id), "theme");
    await page.keyboard.press("Space");
    const dark = await ready(page, "dark");
    assert.equal(dark.fit, false);
    await states(false, true);
    assert.equal(dark.width, manual.width);
    assert.equal(await page.evaluate(() => localStorage.getItem("state-view-theme")), "dark");
    const darkFocus = await page.$eval("#theme", input => {
      const style = getComputedStyle(input.closest("label"));
      return {visible: input.matches(":focus-visible"), width: style.outlineWidth,
        color: style.outlineColor, background: getComputedStyle(document.querySelector("header")).backgroundColor};
    });
    assert(darkFocus.visible);
    assert(parseFloat(darkFocus.width) > 0);
    assert(contrast(darkFocus.color, darkFocus.background) >= 3);
    await page.keyboard.down("Shift");
    await page.keyboard.press("Tab");
    await page.keyboard.up("Shift");
    assert.equal(await page.evaluate(() => document.activeElement.id), "fit");
    await page.keyboard.press("Space");
    assert((await ready(page, "dark")).fit);
    await states(true, true);
    await page.reload({waitUntil: "load"});
    assert((await ready(page, "dark")).fit, "Default Fit width remains enabled on a fresh document");
    await page.click('label:has(#theme)');
    await ready(page, "light");
  } finally { await context.close(); }
});

test("OS initial theme, readable status colors, Fit width and manual resize/toggle choices", async () => {
  for (const osTheme of ["light", "dark"]) {
    const {page, context, evidence} = await pageFor({osTheme});
    try {
      const initial = await ready(page, osTheme);
      assert(initial.fit && Math.abs(initial.width - initial.available) < 1);
      const initialColors = await palette(page);
      assert.equal(Object.keys(initialColors.nodes).length, 5);
      assertReadable(initialColors);
      assert.notEqual(initialColors.nodes.running.dash, "none");
      await page.click("#fit");
      const width = await page.$eval("#diagram > svg", svg => svg.getBoundingClientRect().width);
      const other = osTheme === "dark" ? "light" : "dark";
      await page.click("#theme");
      const manual = await ready(page, other);
      assert.equal(manual.fit, false);
      const toggledColors = await palette(page);
      assertReadable(toggledColors);
      assert.equal(toggledColors.nodes.running.dash, initialColors.nodes.running.dash);
      await page.setViewport({width: 390, height: 844});
      assert.equal(await page.$eval("#diagram > svg", svg => svg.getBoundingClientRect().width), manual.width);
      // Both themes retain the same natural-size rendering, not a forced Fit reset.
      assert.ok(Math.abs(manual.width - width) < 1);
      await page.click("#fit");
      const fitted = await ready(page, other);
      assert(Math.abs(fitted.width - fitted.available) < 1);
      const colors = await palette(page);
      const point = await page.$eval("#diagram > svg", e => {
        const r = e.getBoundingClientRect();
        return {x: r.left + r.width / 2, y: r.top + r.height / 2};
      });
      await page.mouse.move(point.x, point.y);
      await page.mouse.wheel({deltaY: -120});
      await page.waitForFunction(w => document.querySelector("#diagram > svg").getBoundingClientRect().width > w,
        {}, fitted.width);
      assert.deepEqual(await palette(page), colors, "Zoom must not alter the real status palette");
      assert.deepEqual(evidence.errors, []);
      assert.deepEqual(evidence.externalRequests, []);
    } finally { await context.close(); }
  }
});

test("Explicit choice persists across reload and overrides later OS changes", async () => {
  const {page, context} = await pageFor({osTheme: "dark"});
  try {
    await ready(page, "dark");
    await page.click("#theme");
    await ready(page, "light");
    assert.equal(await page.evaluate(() => localStorage.getItem("state-view-theme")), "light");
    await page.reload({waitUntil: "load"});
    await ready(page, "light");
    await page.emulateMediaFeatures([{name: "prefers-color-scheme", value: "light"}]);
    await page.emulateMediaFeatures([{name: "prefers-color-scheme", value: "dark"}]);
    await ready(page, "light");
    await page.focus("#theme");
    await page.keyboard.press("Space");
    await ready(page, "dark");
  } finally { await context.close(); }
});

test("OS changes follow automatically without a stored preference; blocked storage is safe", async () => {
  const {page, context} = await pageFor({storageBlocked: true});
  try {
    await ready(page, "light");
    await page.emulateMediaFeatures([{name: "prefers-color-scheme", value: "dark"}]);
    await ready(page, "dark");
    await page.click("#theme");
    await ready(page, "light");
    await page.emulateMediaFeatures([{name: "prefers-color-scheme", value: "light"}]);
    await page.emulateMediaFeatures([{name: "prefers-color-scheme", value: "dark"}]);
    await ready(page, "light");
    await page.$eval("#theme", button => { button.click(); button.click(); button.click(); });
    await ready(page, "dark");
  } finally { await context.close(); }
});

test("Rerender preserves browser zoom/scroll and last-good SVG on failure, then recovers", async () => {
  const {page, context} = await pageFor();
  try {
    await ready(page, "light");
    await page.setViewport({width: 390, height: 844});
    await page.click("#fit");
    await page.$eval("main", main => { main.scrollLeft = 120; });
    const cdp = await page.createCDPSession();
    await cdp.send("Emulation.setPageScaleFactor", {pageScaleFactor: 1.5});
    const before = await page.evaluate(() => ({
      scroll: document.querySelector("main").scrollLeft, zoom: visualViewport.scale,
    }));
    assert(before.scroll > 0 && before.zoom > 1);
    await page.$eval("#theme", button => button.click());
    await ready(page, "dark");
    const after = await page.evaluate(() => ({
      scroll: document.querySelector("main").scrollLeft, zoom: visualViewport.scale,
    }));
    assert.deepEqual(after, before);
    await page.evaluate(() => {
      window.originalRender = mermaid.render;
      mermaid.render = async () => { throw new Error("Test rendering failure"); };
      document.querySelector("#theme").click();
    });
    await page.waitForFunction(() => document.body.dataset.renderError);
    assert.equal(await page.evaluate(() => document.body.dataset.sourceSha256), undefined);
    assert.equal(await page.$eval("#diagram > svg", svg => svg.dataset.theme), "dark");
    assertReadable(await palette(page));
    await page.evaluate(() => {
      mermaid.render = window.originalRender;
      document.querySelector("#theme").click();
    });
    assert.equal((await ready(page, "dark")).fit, false);
  } finally { await context.close(); }
});
