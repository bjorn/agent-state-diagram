// Frontend-only fixtures: no service, live state, downloads, or lifecycle changes.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {after, before, test} from "node:test";
import {fileURLToPath, pathToFileURL} from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const template = await fs.readFile(path.join(here, "../assets/templates/index.html"), "utf8");
const dashboard = await fs.readFile(path.join(here, "../assets/static/dashboard.js"), "utf8");
const origin = "http://127.0.0.1:16919";
const code = "flowchart LR\n  a --> b\n";
const source = `# State\n\n\`\`\`mermaid\n${code}\`\`\`\n`;
const digest = createHash("sha256").update(source).digest("hex");
const svg = width => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 1200" width="${width}"><rect width="${width}" height="1200"/></svg>`;
const html = template
  .replace(/\{%[\s\S]*?%\}/g, "")
  .replaceAll("{{ source_hash }}", digest)
  .replaceAll("{{ source | base64_encode }}", Buffer.from(source).toString("base64"))
  .replaceAll('{{ source_hash | truncate(length=12, end="") }}', digest.slice(0, 12))
  .replace("{{ source | markdown | safe }}", `<h1>State</h1><pre><code class="language-mermaid">${code}</code></pre>`)
  .replaceAll("{{ reload_hash }}", createHash("sha256").update("").digest("base64"))
  .replaceAll("{{ port }}", "16919");

let browser;
before(async () => {
  let modulePath = process.env.PUPPETEER_MODULE;
  if (!modulePath) {
    const cache = path.join(os.homedir(), ".npm/_npx");
    for (const entry of await fs.readdir(cache)) {
      const root = path.join(cache, entry, "node_modules/puppeteer");
      try {
        const metadata = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
        modulePath = path.resolve(root, metadata.main);
        await fs.access(modulePath);
        break;
      } catch { modulePath = undefined; }
    }
  }
  assert(modulePath, "Use cached Puppeteer only; no download fallback");
  const {default: puppeteer} = await import(pathToFileURL(modulePath));
  browser = await puppeteer.launch({
    headless: true, args: ["--no-sandbox", "--disable-background-networking"],
  });
});
after(async () => { await browser?.close(); });

async function fixture(run) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  try {
    await page.setViewport({width: 1280, height: 900});
    await page.setRequestInterception(true);
    page.on("request", request => {
      const url = request.url();
      if (url === `${origin}/`) {
        request.respond({contentType: "text/html", body: html});
      } else if (url === `${origin}/dashboard.js`) {
        request.respond({contentType: "text/javascript", body: dashboard});
      } else if (url === `${origin}/favicon.ico`) {
        request.respond({status: 204});
      } else if (url === `${origin}/mermaid-12.3.0.min.js`) {
        // Hold render completion so a user choice can occur before SVG insertion.
        request.respond({contentType: "text/javascript", body: `
          window.mermaid = {
            initialize() {},
            render() {
              return new Promise(resolve => {
                window.finishRender = () => resolve({svg: ${JSON.stringify(svg(2400))}});
              });
            }
          };
        `});
      } else {
        errors.push(`Unexpected request: ${url}`);
        request.abort();
      }
    });
    // Every request is answered in memory. No listener or live HTTP service is used.
    await page.goto(origin, {waitUntil: "load"});
    await page.waitForFunction(() => typeof window.finishRender === "function");
    await run(page);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function completeRender(page) {
  await page.evaluate(() => window.finishRender());
  await page.waitForSelector("#diagram > svg");
  assert.equal(await page.evaluate(() => document.body.dataset.renderError), undefined);
}

async function dimensions(page) {
  return page.evaluate(() => ({
    checked: document.querySelector("#fit").checked,
    width: document.querySelector("#diagram > svg").getBoundingClientRect().width,
    available: document.querySelector("#diagram").getBoundingClientRect().width,
  }));
}

async function expectFit(page) {
  const view = await dimensions(page);
  assert.equal(view.checked, true);
  assert.ok(Math.abs(view.width - view.available) < 1, JSON.stringify(view));
}

test("Fit width defaults on and applies after render, new SVG, and viewport resize", async () => {
  await fixture(async page => {
    assert.equal(await page.$eval("#fit", input => input.checked), true);
    await completeRender(page);
    await expectFit(page);
    await page.setViewport({width: 720, height: 900});
    await expectFit(page);
    await page.$eval("#diagram", (diagram, replacement) => {
      diagram.innerHTML = replacement;
    }, svg(3200));
    await expectFit(page);
  });
});

test("An explicit manual choice survives asynchronous render and viewport resize", async () => {
  await fixture(async page => {
    await page.$eval("#fit", input => { input.checked = false; });
    await completeRender(page);
    await page.setViewport({width: 720, height: 900});
    const manual = await dimensions(page);
    assert.equal(manual.checked, false);
    assert.equal(manual.width, 2400);
    assert.ok(manual.width > manual.available);
    await page.click("#fit");
    await expectFit(page);
    await page.setViewport({width: 1024, height: 900});
    await expectFit(page);
  });
});
