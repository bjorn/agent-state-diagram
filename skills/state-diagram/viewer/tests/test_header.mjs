// Serverless fixtures only. Every browser request is answered in memory or aborted.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {after, before, test} from "node:test";
import {fileURLToPath} from "node:url";
import {launchBrowser} from "./browser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const template = await fs.readFile(path.join(here, "../assets/templates/index.html"), "utf8");
const dashboard = await fs.readFile(path.join(here, "../assets/static/dashboard.js"), "utf8");
const origin = "http://127.0.0.1:1119";
const code = 'flowchart LR\n  a["État &quot; &amp; &lt;test&gt;"] --> b["Local"]\n';
const source = `# State\n\n\`\`\`mermaid\n${code}\`\`\`\n`.replaceAll("\n", "\r\n");
const bytes = Buffer.from(source);
const digest = createHash("sha256").update(bytes).digest("hex");
const start = Date.UTC(2026, 10, 10, 22, 59, 58);
const finish = Date.UTC(2026, 10, 11, 0, 15, 9);
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2400 1200"><rect width="2400" height="1200"/></svg>';
const escape = text => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const html = template.replace(/\{%[\s\S]*?%\}/g, "")
  .replaceAll("{{ source_hash }}", digest)
  .replaceAll("{{ source | base64_encode }}", bytes.toString("base64"))
  .replaceAll('{{ source_hash | truncate(length=12, end="") }}', digest.slice(0, 12))
  .replace("{{ source | markdown | safe }}", `<h1>State</h1><pre><code class="language-mermaid">${escape(code)}</code></pre>`)
  .replaceAll("{{ reload_hash }}", createHash("sha256").update("").digest("base64"))
  .replaceAll("{{ port }}", "1119");
let browser;

before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

async function fixture(run, {corruptHash = false, corruptFence = false} = {}) {
  const page = await browser.newPage();
  const failures = [];
  try {
    await page.emulateTimezone("Europe/Copenhagen");
    await page.emulateMediaFeatures([{name: "prefers-color-scheme", value: "light"}]);
    await page.setViewport({width: 1280, height: 900});
    await page.evaluateOnNewDocument(now => {
      localStorage.removeItem("state-view-theme");
      window.clockNow = now;
      const RealDate = Date;
      window.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [window.clockNow])); }
        static now() { return window.clockNow; }
      };
      window.intervalCalls = 0;
      const interval = window.setInterval;
      window.setInterval = (...args) => { window.intervalCalls++; return interval(...args); };
    }, start);
    page.on("pageerror", error => failures.push(String(error)));
    await page.setRequestInterception(true);
    page.on("request", q => {
      const url = q.url();
      if (url === origin + "/") {
        let body = html;
        if (corruptHash) body = body.replace(`content="${digest}"`, `content="${"0".repeat(64)}"`);
        if (corruptFence) body = body.replace(escape(code), "flowchart LR\n  wrong --> fence\n");
        q.respond({contentType: "text/html", body});
      } else if (url === origin + "/dashboard.js") {
        q.respond({contentType: "text/javascript", body: dashboard});
      } else if (url === origin + "/mermaid-12.3.0.min.js") {
        q.respond({contentType: "text/javascript", body: `
          window.renderJobs = [];
          window.mermaid = {
            initialize(config) { window.mermaidConfig = config; },
            render(id, code) {
              return new Promise((resolve, reject) => window.renderJobs.push({
                id, code, theme: window.mermaidConfig.theme, resolve, reject
              }));
            }
          };
        `});
      } else if (url === origin + "/favicon.ico") {
        q.respond({status: 204});
      } else {
        failures.push("Unexpected request: " + url);
        q.abort();
      }
    });
    await page.goto(origin, {waitUntil: "load"});
    await run(page);
    assert.deepEqual(failures, []);
  } finally { await page.close(); }
}

async function jobs(page, count) {
  await page.waitForFunction(n => window.renderJobs?.length === n, {}, count);
}
async function resolve(page, index, now, outcome = "ok") {
  await page.evaluate(({index, now, outcome, svg}) => {
    window.clockNow = now;
    const job = window.renderJobs[index];
    if (outcome === "error") job.reject(new Error("Fixture failure"));
    else job.resolve({svg: outcome === "missing-svg" ? "<div>not an SVG</div>" : svg});
  }, {index, now, outcome, svg});
}
async function timestamp(page) {
  return page.$eval("#last-refresh", e => ({iso: e.getAttribute("datetime"), text: e.textContent}));
}
async function ready(page, iso) {
  await page.waitForFunction(({digest, iso}) =>
    document.body.dataset.sourceSha256 === digest &&
    document.querySelector("#diagram > svg")?.dataset.sourceSha256 === digest &&
    document.querySelector("#last-refresh").getAttribute("datetime") === iso,
  {}, {digest, iso});
}
async function expectStamp(page, now) {
  const actual = await timestamp(page);
  assert.equal(actual.iso, new Date(now).toISOString());
  const local = await page.evaluate(now => new Date(now).toLocaleString(), now);
  assert.equal(actual.text, local);
}

test("Header hides only the rendered heading/hash/status and stamps successful local completion", async () => {
  await fixture(async page => {
    await jobs(page, 1);
    assert.deepEqual(await timestamp(page), {iso: null, text: "Not yet"});
    assert.equal(await page.$eval("#markdown > h1", e => e.textContent), "State");
    assert.equal(await page.$eval("#markdown > h1", e => getComputedStyle(e).display), "none");
    assert.equal(await page.$("#digest"), null);
    assert.equal(await page.$eval('meta[name="state-source-base64"]', e => e.content), bytes.toString("base64"));
    const header = await page.$eval("header", e => e.innerText);
    assert(header.startsWith("Last refresh: Not yet"));
    assert(!/Canonical Markdown|Rendering canonical|Source:|\bOn\b|\bOff\b/.test(header));
    await resolve(page, 0, finish);
    await ready(page, new Date(finish).toISOString());
    await expectStamp(page, finish);
    const metadata = await page.evaluate(() => ({
      source: document.querySelector('meta[name="state-source-sha256"]').content,
      body: document.body.dataset.sourceSha256,
      svg: document.querySelector("#diagram > svg").dataset.sourceSha256,
      error: document.body.dataset.renderError,
    }));
    assert.deepEqual(metadata, {source: digest, body: digest, svg: digest});
    assert.equal(await page.$eval("#render-error", e => e.hidden), true);
  });
});

test("Timestamp is not a clock: Fit width and viewport changes do not refresh it", async () => {
  await fixture(async page => {
    await jobs(page, 1);
    await resolve(page, 0, finish);
    await ready(page, new Date(finish).toISOString());
    await page.evaluate(() => { window.clockNow += 86400000; });
    await page.click("#fit");
    await page.setViewport({width: 720, height: 900});
    await expectStamp(page, finish);
    assert.equal(await page.evaluate(() => window.intervalCalls), 0);
    assert.equal(await page.evaluate(() => window.renderJobs.length), 1);
    assert.equal(await page.$eval("#diagram > svg", e => e.getBoundingClientRect().width), 2400);
  });
});

test("Superseded and failed renders keep the last-success timestamp; retry updates only on success", async () => {
  await fixture(async page => {
    await jobs(page, 1);
    await resolve(page, 0, finish);
    await ready(page, new Date(finish).toISOString());
    await page.click("#theme");
    await jobs(page, 2);
    assert.equal(await page.evaluate(() => document.body.dataset.sourceSha256), undefined);
    await page.$eval("#theme", e => { e.click(); e.click(); });
    await resolve(page, 1, finish + 10000); // stale revision must not stamp
    await jobs(page, 3);
    await expectStamp(page, finish);
    await resolve(page, 2, finish + 20000, "error");
    await page.waitForFunction(() => document.body.dataset.renderError === "Fixture failure");
    await expectStamp(page, finish);
    assert.equal(await page.$eval("#render-error", e => e.hidden), false);
    assert.equal(await page.evaluate(() => document.body.dataset.sourceSha256), undefined);
    await page.click("#theme");
    await jobs(page, 4);
    await expectStamp(page, finish);
    assert.equal(await page.$eval("#render-error", e => e.hidden), true);
    await resolve(page, 3, finish + 30000);
    await ready(page, new Date(finish + 30000).toISOString());
    await expectStamp(page, finish + 30000);
  });
});

for (const [name, options, message] of [
  ["bad hidden source digest", {corruptHash: true}, /digest mismatch/],
  ["rendered/canonical fence mismatch", {corruptFence: true}, /fence differs/],
]) {
  test(`${name} never creates a successful refresh timestamp`, async () => {
    await fixture(async page => {
      await page.waitForFunction(() => Boolean(document.body.dataset.renderError));
      assert.match(await page.evaluate(() => document.body.dataset.renderError), message);
      assert.deepEqual(await timestamp(page), {iso: null, text: "Not yet"});
      assert.equal(await page.evaluate(() => window.renderJobs.length), 0);
      assert.equal(await page.$("#diagram > svg"), null);
      assert.equal(await page.evaluate(() => document.body.dataset.sourceSha256), undefined);
      assert.equal(await page.$eval("#render-error", e => e.hidden), false);
      assert(await page.$("pre > code.language-mermaid"), "Readable raw-code fallback remains");
    }, options);
  });
}

test("Mermaid failure or missing SVG cannot advance the timestamp", async () => {
  for (const outcome of ["error", "missing-svg"]) {
    await fixture(async page => {
      await jobs(page, 1);
      await resolve(page, 0, finish, outcome);
      await page.waitForFunction(() => Boolean(document.body.dataset.renderError));
      assert.deepEqual(await timestamp(page), {iso: null, text: "Not yet"});
      assert.equal(await page.evaluate(() => document.body.dataset.sourceSha256), undefined);
    });
  }
});

async function expectFit(page) {
  const view = await page.evaluate(() => ({
    fit: document.querySelector("#fit").checked,
    width: document.querySelector("#diagram > svg").getBoundingClientRect().width,
    available: document.querySelector("#diagram").getBoundingClientRect().width,
  }));
  assert(view.fit && Math.abs(view.width - view.available) < 1, JSON.stringify(view));
}

test("Fit defaults on for delayed render, new SVG and viewport resize", async () => {
  await fixture(async page => {
    await jobs(page, 1);
    assert.equal(await page.$eval("#fit", e => e.checked), true);
    await resolve(page, 0, finish);
    await ready(page, new Date(finish).toISOString());
    await expectFit(page);
    await page.setViewport({width: 720, height: 900});
    await expectFit(page);
    await page.$eval("#diagram", (diagram, replacement) => {
      diagram.innerHTML = replacement;
    }, svg.replaceAll("2400", "3200"));
    await expectFit(page);
  });
});

test("Manual choice while rendering is pending survives completion and resize", async () => {
  await fixture(async page => {
    await jobs(page, 1);
    await page.focus("#fit");
    await page.keyboard.press("Space");
    await resolve(page, 0, finish);
    await ready(page, new Date(finish).toISOString());
    await page.setViewport({width: 720, height: 900});
    assert.equal(await page.$eval("#fit", e => e.checked), false);
    assert.equal(await page.$eval("#diagram > svg", e => e.getBoundingClientRect().width), 2400);
    await page.click("#fit");
    await expectFit(page);
    await page.setViewport({width: 1024, height: 900});
    await expectFit(page);
  });
});
