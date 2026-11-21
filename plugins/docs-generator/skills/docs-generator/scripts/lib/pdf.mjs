// Prints the HTML rendering to PDF with a Chromium-based browser and Paged.js.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { renderHtml } from "./html.mjs";
import { SKILL_ROOT } from "./theme.mjs";

const PAGED = join(SKILL_ROOT, "assets", "paged.polyfill.min.js");

export class BrowserNotFound extends Error {}

export const BROWSER_HINT =
  "No Chrome, Edge or Chromium was found to print the PDF. Install Chrome, or run `npx playwright install chromium`, " +
  "or set DOCS_GENERATOR_CHROMIUM to a browser executable. DOCX output (--format docx) does not need a browser.";

/**
 * Uses DOCS_GENERATOR_CHROMIUM when it is set (and only it); otherwise tries installed Chrome, installed Edge,
 * then Playwright's own Chromium.
 */
export async function launchBrowser() {
  const { chromium } = await import("playwright-core");
  const explicit = process.env.DOCS_GENERATOR_CHROMIUM;
  const attempts = explicit ? [{ executablePath: explicit }] : [{ channel: "chrome" }, { channel: "msedge" }, {}];
  for (const opts of attempts) {
    try {
      return await chromium.launch({ headless: true, ...opts });
    } catch {
      // try the next one
    }
  }
  throw new BrowserNotFound(explicit ? `DOCS_GENERATOR_CHROMIUM=${explicit} could not be started. ${BROWSER_HINT}` : BROWSER_HINT);
}

/** Writes `outFile` and returns the number of pages. */
export async function renderPdf(model, theme, outFile, { browser, previewDir } = {}) {
  const html = renderHtml(model, theme, { pagedScript: PAGED });
  const dir = mkdtempSync(join(tmpdir(), "docs-generator-"));
  const htmlFile = join(dir, "document.html");
  writeFileSync(htmlFile, html);
  const own = !browser;
  browser ??= await launchBrowser();
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: "load" });
    try {
      await page.waitForFunction(() => window.__pagedDone === true, null, { timeout: 120_000 });
    } catch {
      throw new Error(`pagination did not finish${pageErrors.length ? `: ${pageErrors.join("; ")}` : ""}`);
    }
    await page.evaluate(() => document.fonts.ready);
    const pages = await page.evaluate(() => document.querySelectorAll(".pagedjs_page").length);
    if (previewDir) {
      // One PNG per page, from the same paginated layout that is printed, for review by eye.
      await page.emulateMedia({ media: "screen" });
      const handles = await page.$$(".pagedjs_page");
      for (let i = 0; i < handles.length; i++)
        await handles[i].screenshot({ path: join(previewDir, `page-${String(i + 1).padStart(2, "0")}.png`) });
      await page.emulateMedia({ media: "print" });
    }
    await page.pdf({ path: outFile, preferCSSPageSize: true, printBackground: true, tagged: true, outline: true });
    await page.close();
    return { pages };
  } finally {
    if (own) await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
