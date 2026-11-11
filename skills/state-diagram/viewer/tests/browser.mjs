// Test-only cached browser entrypoint. Never install or discover another toolchain.
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";

export async function launchBrowser() {
  assert(process.env.PUPPETEER_MODULE, "Set PUPPETEER_MODULE to an existing cached module; no downloads");
  assert(process.env.PUPPETEER_EXECUTABLE_PATH, "Set PUPPETEER_EXECUTABLE_PATH to existing Chromium");
  const {default: puppeteer} = await import(pathToFileURL(process.env.PUPPETEER_MODULE));
  return puppeteer.launch({headless: true, pipe: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    args: ["--no-sandbox", "--disable-background-networking", "--disable-component-update", "--no-first-run"]});
}
