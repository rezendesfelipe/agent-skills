#!/usr/bin/env node
// docs-generator engine: check and build documents, check and create themes, write Office themes.
// Usage: node scripts/docs.mjs <command> [options]   (run with --help)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  console.error(`docs-generator requires Node.js 20 or later (found ${process.version}).`);
  process.exit(2);
}
try {
  await import("yaml");
} catch {
  const skill = fileURLToPath(new URL("..", import.meta.url));
  console.error(`The engine's dependencies are not installed. Run:\n  cd "${skill}" && npm ci --omit=dev`);
  process.exit(2);
}

const { loadSource, LANGS } = await import("./lib/source.mjs");
const { loadTheme, bundledThemeNames, bundledThemePath, DEFAULT_THEME } = await import("./lib/theme.mjs");

const EXIT = { OK: 0, FAILED: 1, USAGE: 2 };
class UsageError extends Error {}

const HELP = `docs-generator engine

Usage: node scripts/docs.mjs <command> [options]

Commands:
  check <source.md>                 Validate a source document
  build <source.md>                 Build PDF and/or DOCX
      --format pdf,docx             Formats to build (default: pdf,docx)
      --theme <file|name>           Theme file or bundled theme (default: docs-theme.json next to the source, else ${DEFAULT_THEME})
      --out <folder>                Output folder (default: the source's folder)
      --preview <folder>            Also write one PNG per PDF page, for review
  theme check [<file|name>]         Validate a theme and print it with defaults filled in
  theme init [--from <name>] [--out <file>]
                                    Write an editable copy of a bundled theme (default: docs-theme.json)
  office-theme [--theme <file|name>] [--out <folder>] [--lang pt-BR|en|es]
                                    Write <theme>.xltx (Excel template) and <theme>.thmx (Office theme)

Every command accepts --json (result object on stdout, messages on stderr).
Exit codes: 0 success, 1 validation or rendering failure, 2 usage error.
Bundled themes: ${bundledThemeNames().join(", ")}. Languages: ${LANGS.join(", ")}.
`;

const { values: opts, positionals } = (() => {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        format: { type: "string" },
        theme: { type: "string" },
        out: { type: "string" },
        from: { type: "string" },
        lang: { type: "string" },
        preview: { type: "string" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (e) {
    console.error(`${e.message}\nRun with --help for usage.`);
    process.exit(EXIT.USAGE);
  }
})();

const json = opts.json;
const log = (msg) => (json ? process.stderr : process.stdout).write(msg + "\n");
const emit = (obj) => json && process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
const fmtProblem = (p) => (typeof p === "string" ? p : `${p.where}: ${p.message}`);

function report(kind, errors, warnings) {
  for (const w of warnings) log(`warning: ${fmtProblem(w)}`);
  for (const e of errors) log(`error: ${fmtProblem(e)}`);
  if (!errors.length) log(`✓ ${kind} is valid`);
}

/** Theme for a source: --theme, else docs-theme.json next to the source, else the default theme. */
function resolveThemeRef(sourcePath) {
  if (opts.theme) return opts.theme;
  const local = join(dirname(resolve(sourcePath)), "docs-theme.json");
  return existsSync(local) ? local : DEFAULT_THEME;
}

async function cmdCheck(source) {
  if (!source) throw new UsageError("check needs a source file: node scripts/docs.mjs check <source.md>");
  const { model, errors, warnings } = loadSource(source);
  const themeRef = resolveThemeRef(source);
  const th = loadTheme(themeRef);
  const allErrors = [...errors, ...th.errors.map((m) => ({ where: `theme ${themeRef}`, message: m }))];
  const allWarnings = [...warnings, ...th.warnings.map((m) => ({ where: `theme ${themeRef}`, message: m }))];
  report("source", allErrors, allWarnings);
  emit({ ok: !allErrors.length, errors: allErrors, warnings: allWarnings, theme: th.source, toc: model?.toc });
  return allErrors.length ? EXIT.FAILED : EXIT.OK;
}

async function cmdBuild(source) {
  if (!source) throw new UsageError("build needs a source file: node scripts/docs.mjs build <source.md>");
  const formats = (opts.format ?? "pdf,docx").split(",").map((f) => f.trim()).filter(Boolean);
  const bad = formats.filter((f) => !["pdf", "docx"].includes(f));
  if (bad.length || !formats.length) throw new UsageError(`--format accepts pdf and docx (got: ${opts.format})`);

  const { model, errors, warnings } = loadSource(source);
  const themeRef = resolveThemeRef(source);
  const th = loadTheme(themeRef);
  const allErrors = [...errors, ...th.errors.map((m) => ({ where: `theme ${themeRef}`, message: m }))];
  const allWarnings = [...warnings, ...th.warnings.map((m) => ({ where: `theme ${themeRef}`, message: m }))];
  for (const w of allWarnings) log(`warning: ${fmtProblem(w)}`);
  if (allErrors.length) {
    for (const e of allErrors) log(`error: ${fmtProblem(e)}`);
    log("Nothing was built. Fix the errors above (run `check` to see them again).");
    emit({ ok: false, errors: allErrors, warnings: allWarnings, outputs: [] });
    return EXIT.FAILED;
  }

  const usedDefault = !opts.theme && themeRef === DEFAULT_THEME;
  log(`theme: ${th.theme.name} (${th.source})`);
  if (usedDefault)
    log(`note: no --theme and no docs-theme.json next to the source, so the bundled default "${DEFAULT_THEME}" was used. ` +
      "If the user has a design system or brand, ask before building (see SKILL.md, \"Choosing the theme\").");

  const outDir = resolve(opts.out ?? dirname(resolve(source)));
  mkdirSync(outDir, { recursive: true });
  const name = basename(source, extname(source));
  const outputs = [];
  const failures = [];
  for (const format of formats) {
    const file = join(outDir, `${name}.${format}`);
    try {
      if (format === "docx") {
        const { renderDocx } = await import("./lib/docx.mjs");
        writeFileSync(file, await renderDocx(model, th.theme));
        outputs.push({ format, path: file });
      } else {
        const { renderPdf } = await import("./lib/pdf.mjs");
        if (opts.preview) mkdirSync(resolve(opts.preview), { recursive: true });
        const r = await renderPdf(model, th.theme, file, { previewDir: opts.preview && resolve(opts.preview) });
        outputs.push({ format, path: file, pages: r.pages });
      }
      log(`✓ ${file}`);
    } catch (e) {
      failures.push({ where: format, message: e.message });
      log(`error: ${format}: ${e.message}`);
    }
  }
  emit({ ok: !failures.length, errors: failures, warnings: allWarnings, theme: th.source, themeName: th.theme.name, usedDefaultTheme: usedDefault, outputs });
  return failures.length ? EXIT.FAILED : EXIT.OK;
}

function cmdThemeCheck(ref = DEFAULT_THEME) {
  const th = loadTheme(ref);
  report("theme", th.errors, th.warnings);
  const { baseDir, ...resolved } = th.theme ?? {};
  if (!json && th.theme) log(JSON.stringify(resolved, null, 2));
  emit({ ok: !th.errors.length, errors: th.errors, warnings: th.warnings, source: th.source, theme: th.theme ? resolved : null });
  return th.errors.length ? EXIT.FAILED : EXIT.OK;
}

function cmdThemeInit() {
  const from = opts.from ?? DEFAULT_THEME;
  const src = bundledThemePath(from);
  if (!src) throw new UsageError(`unknown bundled theme "${from}" (bundled: ${bundledThemeNames().join(", ")})`);
  const out = resolve(opts.out ?? "docs-theme.json");
  if (existsSync(out)) {
    log(`error: ${out} already exists; choose another --out or edit it`);
    emit({ ok: false, errors: [`${out} already exists`] });
    return EXIT.FAILED;
  }
  const theme = JSON.parse(readFileSync(src, "utf8"));
  theme.$schema = join(dirname(src), "docs-theme.schema.json");
  theme.name = "my-theme";
  writeFileSync(out, JSON.stringify(theme, null, 2) + "\n");
  log(`✓ ${out} (copy of ${from}; edit it, then run: node scripts/docs.mjs theme check "${out}")`);
  emit({ ok: true, path: out, from });
  return EXIT.OK;
}

async function cmdOfficeTheme() {
  const lang = opts.lang ?? "pt-BR";
  if (!LANGS.includes(lang)) throw new UsageError(`--lang must be one of: ${LANGS.join(", ")}`);
  const th = loadTheme(opts.theme ?? DEFAULT_THEME);
  for (const w of th.warnings) log(`warning: ${w}`);
  if (th.errors.length) {
    for (const e of th.errors) log(`error: ${e}`);
    emit({ ok: false, errors: th.errors, outputs: [] });
    return EXIT.FAILED;
  }
  const { buildThmx, buildXltx } = await import("./lib/office.mjs");
  const outDir = resolve(opts.out ?? ".");
  mkdirSync(outDir, { recursive: true });
  const xltx = join(outDir, `${th.theme.name}.xltx`);
  const thmx = join(outDir, `${th.theme.name}.thmx`);
  writeFileSync(xltx, buildXltx(th.theme, lang));
  writeFileSync(thmx, buildThmx(th.theme));
  log(`✓ ${xltx}\n✓ ${thmx}`);
  emit({ ok: true, outputs: [{ format: "xltx", path: xltx }, { format: "thmx", path: thmx }], warnings: th.warnings });
  return EXIT.OK;
}

async function main() {
  const [command, ...rest] = positionals;
  if (opts.help || !command) {
    (opts.help ? process.stdout : process.stderr).write(HELP);
    return opts.help ? EXIT.OK : EXIT.USAGE;
  }
  try {
    switch (command) {
      case "check": return await cmdCheck(rest[0]);
      case "build": return await cmdBuild(rest[0]);
      case "office-theme": return await cmdOfficeTheme();
      case "theme":
        if (rest[0] === "check") return cmdThemeCheck(rest[1]);
        if (rest[0] === "init") return cmdThemeInit();
        throw new UsageError('theme needs a subcommand: "theme check" or "theme init"');
      default:
        throw new UsageError(`unknown command "${command}". Run with --help for usage.`);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(e.message);
      emit({ ok: false, error: e.message });
      return EXIT.USAGE;
    }
    throw e;
  }
}

process.exitCode = await main();
