// Called only by the copied-skill fixture. Never target a real work map.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";

const [origin, sourcePath] = process.argv.slice(2);
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin));
assert(path.resolve(sourcePath).split(path.sep).some(p => p.startsWith("state-diagram-portable-")),
  "Only the dedicated portable test's synthetic source is writable");
const {default: puppeteer} = await import(pathToFileURL(process.env.PUPPETEER_MODULE));
const hash = b => createHash("sha256").update(b).digest("hex");
const original = await fs.readFile(sourcePath);
const proof = {external: [], pageErrors: [], websocket: [], watch: []};
const browser = await puppeteer.launch({headless: true, pipe: true,
  args: ["--no-sandbox", "--disable-background-networking", "--disable-component-update", "--no-first-run"]});
try {
  const page = await browser.newPage();
  await page.setViewport({width: 1000, height: 700});
  await page.emulateTimezone("America/New_York");
  await page.emulateMediaFeatures([{name: "prefers-color-scheme", value: "dark"}]);
  page.on("pageerror", e => proof.pageErrors.push(String(e)));
  await page.setRequestInterception(true);
  page.on("request", q => {
    if (q.url().startsWith(origin + "/")) q.continue();
    else { proof.external.push(q.url()); q.abort(); }
  });
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");
  cdp.on("Network.webSocketCreated", e => proof.websocket.push(e.url));
  const ready = async bytes => {
    const digest = hash(bytes);
    await page.waitForFunction(d => document.body.dataset.sourceSha256 === d &&
      document.querySelector("#diagram > svg")?.dataset.sourceSha256 === d, {timeout: 12000}, digest);
    const result = await page.evaluate(() => {
      const t = document.querySelector("#last-refresh");
      return {meta: document.querySelector('meta[name="state-source-sha256"]').content,
        encoded: document.querySelector('meta[name="state-source-base64"]').content,
        stamp: t.dateTime, text: t.textContent, expected: new Date(t.dateTime).toLocaleString(),
        hiddenHeading: getComputedStyle(document.querySelector("#markdown > h1")).display === "none",
        header: document.querySelector("header").innerText,
        digestElement: Boolean(document.querySelector("#digest")),
        fit: document.querySelector("#fit").checked, dark: document.querySelector("#theme").checked,
        switches: [...document.querySelectorAll(".toggle")].map(label => ({
          text: label.innerText, role: label.querySelector("input").getAttribute("role"),
          labelRight: label.querySelector("span:not(.toggle-track)").getBoundingClientRect().right,
          trackLeft: label.querySelector(".toggle-track").getBoundingClientRect().left,
        })),
      };
    });
    assert.equal(result.meta, digest);
    assert.deepEqual(Buffer.from(result.encoded, "base64"), bytes);
    assert(result.hiddenHeading && !result.digestElement);
    assert(result.header.startsWith("Last refresh:"));
    assert(!/Canonical Markdown|Source:|\bOn\b|\bOff\b/.test(result.header));
    assert(Number.isFinite(Date.parse(result.stamp)));
    assert.equal(result.text, result.expected);
    assert.deepEqual(result.switches.map(s => s.text), ["Fit width", "Dark mode"]);
    assert(result.switches.every(s => s.role === "switch" && s.labelRight < s.trackLeft));
    delete result.encoded;
    return result;
  };
  await page.goto(origin, {waitUntil: "networkidle0"});
  proof.initial = await ready(original);
  assert(proof.initial.fit && proof.initial.dark);
  await page.focus("#fit");
  await page.keyboard.press("Space");
  assert.equal(await page.$eval("#fit", e => e.checked), false);
  await page.setViewport({width: 900, height: 700});
  await new Promise(r => setTimeout(r, 1100));
  assert.equal(await page.$eval("#last-refresh", e => e.dateTime), proof.initial.stamp);
  await page.click("#fit");
  const bounds = await page.$eval("#diagram > svg", e => {
    const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width};
  });
  await page.mouse.move(bounds.x + bounds.width / 2, Math.max(120, bounds.y + 30));
  await page.mouse.wheel({deltaY: -600});
  await page.waitForFunction(w => !document.querySelector("#fit").checked &&
    document.querySelector("#diagram > svg").getBoundingClientRect().width > w, {}, bounds.width);
  await page.evaluate(() => { document.querySelector("main").scrollLeft = 150; });
  const beforeDrag = await page.$eval("main", e => e.scrollLeft);
  const drag = await page.$eval("#diagram > svg", e => {
    const r = e.getBoundingClientRect();
    return {x: Math.max(80, Math.min(innerWidth - 80, r.x + r.width / 2)),
      y: Math.max(100, Math.min(innerHeight - 80, r.y + r.height / 2))};
  });
  await page.mouse.move(drag.x, drag.y);
  await page.mouse.down({button: "left"});
  await page.mouse.move(drag.x - 50, drag.y, {steps: 4});
  await page.mouse.up({button: "left"});
  assert((await page.$eval("main", e => e.scrollLeft)) > beforeDrag);
  assert.equal(await page.$eval("#last-refresh", e => e.dateTime), proof.initial.stamp);
  await page.click("#theme");
  await page.waitForFunction(() => document.querySelector("#diagram > svg")?.dataset.theme === "light" &&
    document.body.dataset.sourceSha256);
  proof.light = await ready(original);
  assert(!proof.light.dark && !proof.light.fit);
  await page.reload({waitUntil: "networkidle0"});
  assert.equal((await ready(original)).dark, false, "Manual preference survives reload");
  await page.setViewport({width: 390, height: 780});
  proof.mobile = await ready(original);
  for (let i = 0; i < 3; i++) {
    const bytes = Buffer.from(`# State\r\n\r\n\`\`\`mermaid\r\nflowchart LR\r\n a["État ${i} &amp;"] --> b[Local]\r\n\`\`\`\r\n`);
    if (i === 1) {
      const temporary = path.join(path.dirname(sourcePath), ".browser-replacement");
      await fs.writeFile(temporary, bytes);
      await fs.rename(temporary, sourcePath);
    } else await fs.writeFile(sourcePath, bytes);
    proof.watch.push({atomic: i === 1, sha256: hash(bytes), rendered: await ready(bytes)});
  }
  assert(proof.websocket.length >= 3);
  assert(proof.websocket.every(u => u === origin.replace("http:", "ws:") + "/livereload"));
  assert.deepEqual(proof.external, []);
  assert.deepEqual(proof.pageErrors, []);
  proof.passed = true;
} finally {
  await browser.close();
  if (process.env.STATE_DIAGRAM_TEST_ARTIFACTS) {
    await fs.writeFile(path.join(process.env.STATE_DIAGRAM_TEST_ARTIFACTS, "live.json"),
      JSON.stringify(proof, null, 2) + "\n");
  }
}
