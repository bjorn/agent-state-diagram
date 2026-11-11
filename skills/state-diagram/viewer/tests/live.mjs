// Called only by the copied-skill fixture. Never target a real work map.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {execFile} from "node:child_process";
import net from "node:net";
import {promisify} from "node:util";
import {setTimeout as delay} from "node:timers/promises";
import {launchBrowser} from "./browser.mjs";

const [origin, sourcePath, python] = process.argv.slice(2);
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin));
assert(path.resolve(sourcePath).split(path.sep).some(p => p.startsWith("state-diagram-portable-")),
  "Only the dedicated portable test's synthetic source is writable");
assert(python && path.isAbsolute(python), "The owning Python fixture supplies its interpreter");
const execute = promisify(execFile);
const cli = async (...args) => JSON.parse((await execute(python, [
  fileURLToPath(new URL("../serve.py", import.meta.url)), "--site", path.dirname(path.dirname(sourcePath)),
  ...args], {timeout: 20000})).stdout);
const hash = b => createHash("sha256").update(b).digest("hex");
const original = await fs.readFile(sourcePath);
const proof = {external: [], pageErrors: [], websocket: [], watch: []};
const browser = await launchBrowser();
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
  const socketIds = new Set();
  cdp.on("Network.webSocketCreated", e => { socketIds.add(e.requestId); proof.websocket.push(e.url); });
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
  await delay(1100);
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
  // Keep this browser/page alive through an actual F4 stop/same-port restart.
  const retainedTarget = page.target(), previousSockets = new Set(socketIds);
  let connected;
  const reconnect = new Promise(resolve => { connected = resolve; });
  const accept = e => {
    if (!previousSockets.has(e.requestId) && e.response.status === 101) connected();
  };
  cdp.on("Network.webSocketHandshakeResponseReceived", accept);
  try {
    const port = Number(new URL(origin).port);
    const traffic = await new Promise((resolve, reject) => {
      const chunks = [];
      let clientPort;
      const socket = net.createConnection({host: "127.0.0.1", port, allowHalfOpen: true});
      socket.setTimeout(2000, () => socket.destroy(new Error("Server EOF timed out")));
      socket.once("error", reject);
      socket.once("connect", () => {
        clientPort = socket.localPort;
        socket.write("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
      });
      socket.on("data", chunk => chunks.push(chunk));
      // Server FIN first, then client FIN: make server-side TIME_WAIT deterministic.
      socket.once("end", () => socket.end(() => resolve({clientPort, body: Buffer.concat(chunks)})));
    });
    assert(traffic.body.toString().startsWith("HTTP/1.1 200"));
    const old = await cli("--status");
    assert((await cli("--stop")).stopped);
    const tcpRows = async () => (await fs.readFile("/proc/net/tcp", "utf8")).trim().split("\n").slice(1)
      .map(line => line.trim().split(/\s+/))
      .filter(row => parseInt(row[1].split(":")[1], 16) === port);
    const rows = await tcpRows();
    assert(!rows.some(row => row[3] === "0A"), "Stopped listener is gone");
    const timeWait = rows.find(row => row[3] === "06" &&
      parseInt(row[2].split(":")[1], 16) === traffic.clientPort);
    assert(timeWait, "The real connection remains in server-side TIME_WAIT");
    const startedAt = performance.now(), restarted = await cli("--port", String(port));
    assert.equal(restarted.url, old.url);
    assert.notEqual(restarted.pid, old.pid);
    assert(restarted.source_current);
    const cliSeconds = (performance.now() - startedAt) / 1000;
    assert((await tcpRows()).some(row => row[1] === timeWait[1] && row[2] === timeWait[2] && row[3] === "06"),
      "Restart did not wait for TIME_WAIT expiry");
    await Promise.race([reconnect, delay(12000, undefined, {ref: false}).then(() => {
      throw new Error("Surviving page did not reconnect LiveReload");
    })]);
    proof.restart = {port, oldPid: old.pid, newPid: restarted.pid,
      cliSeconds, reconnectSecondsSinceStart: (performance.now() - startedAt) / 1000,
      timeWait: timeWait.slice(1, 4),
      reconnected: true};
  } finally { cdp.off("Network.webSocketHandshakeResponseReceived", accept); }
  for (let i = 0; i < 3; i++) {
    const bytes = Buffer.from(`# State\r\n\r\n\`\`\`mermaid\r\nflowchart LR\r\n a["État ${i} &amp;"] --> b[Local]\r\n\`\`\`\r\n`);
    if (i === 1) {
      const temporary = path.join(path.dirname(sourcePath), ".browser-replacement");
      await fs.writeFile(temporary, bytes);
      await fs.rename(temporary, sourcePath);
    } else await fs.writeFile(sourcePath, bytes);
    proof.watch.push({atomic: i === 1, sha256: hash(bytes), rendered: await ready(bytes)});
  }
  assert.equal(page.target(), retainedTarget, "Same page survives restart and watched reloads");
  proof.restart.sameBrowserPage = true;
  proof.restart.watchedReloads = proof.watch.length;
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
