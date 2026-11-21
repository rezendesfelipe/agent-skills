// Theme loading, defaults and WCAG contrast checks.
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv/dist/2020.js";

export const SKILL_ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const THEMES_DIR = join(SKILL_ROOT, "themes");
export const FONTS_DIR = join(SKILL_ROOT, "assets", "fonts");
export const DEFAULT_THEME = "clean-modern";

/** Fonts shipped with the skill: family → face files. */
export const BUNDLED_FONTS = {
  "Public Sans": {
    regular: join(FONTS_DIR, "PublicSans-Regular.ttf"),
    bold: join(FONTS_DIR, "PublicSans-Bold.ttf"),
    italic: join(FONTS_DIR, "PublicSans-Italic.ttf"),
    boldItalic: join(FONTS_DIR, "PublicSans-BoldItalic.ttf"),
  },
};

/** Generic CSS families: always available, mapped to a common font in Office files. */
export const GENERIC_FONTS = { "sans-serif": "Arial", serif: "Georgia", monospace: "Consolas" };

/** Minimum WCAG 2.x contrast ratios checked on every theme. */
export const CONTRAST_RULES = [
  { fg: "text", bg: "background", min: 4.5, use: "body text" },
  { fg: "textMuted", bg: "background", min: 4.5, use: "secondary text" },
  { fg: "accent", bg: "background", min: 3, use: "headings and links (large text)" },
  { fg: "onAccent", bg: "accent", min: 4.5, use: "text on the cover band" },
  { fg: "text", bg: "tableHeader", min: 4.5, use: "table header text" },
];

const schema = JSON.parse(readFileSync(join(THEMES_DIR, "docs-theme.schema.json"), "utf8"));
const validateSchema = new Ajv({ allErrors: true, strict: false }).compile(schema);

export function bundledThemeNames() {
  return ["clean-modern"];
}

/** Path of a bundled theme by name, or null. */
export function bundledThemePath(name) {
  const p = join(THEMES_DIR, `${name}.json`);
  return bundledThemeNames().includes(name) && existsSync(p) ? p : null;
}

function deepMerge(base, over) {
  if (Array.isArray(over) || typeof over !== "object" || over === null) return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = typeof v === "object" && v !== null && !Array.isArray(v) && typeof base?.[k] === "object" ? deepMerge(base[k], v) : v;
  }
  return out;
}

// ---- color math (WCAG 2.x relative luminance) -------------------------------------------

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  return "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("").toUpperCase();
}

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb([h, s, l]) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/**
 * Nearest color to `fg` (same hue and saturation, lightness moved) that reaches `min` against `bg`.
 * Used to suggest a fix when a theme fails a contrast check.
 */
export function nearestPassingColor(fg, bg, min) {
  const [h, s, l] = rgbToHsl(hexToRgb(fg));
  const darker = luminance(bg) > 0.18;
  for (let step = 0; step <= 100; step++) {
    const nl = darker ? l - step / 100 : l + step / 100;
    if (nl < 0 || nl > 1) break;
    const c = rgbToHex(hslToRgb([h, s, nl]));
    if (contrastRatio(c, bg) >= min) return c;
  }
  return darker ? "#000000" : "#FFFFFF";
}

// ---- loading ----------------------------------------------------------------------------

/**
 * Loads a theme by bundled name or file path, fills missing fields from clean-modern and checks it.
 * @returns {{ theme: object|null, errors: string[], warnings: string[], source: string }}
 */
export function loadTheme(ref = DEFAULT_THEME, { cwd = process.cwd() } = {}) {
  const errors = [];
  const warnings = [];
  const path = bundledThemePath(ref) ?? (isAbsolute(ref) ? ref : resolve(cwd, ref));
  if (!existsSync(path)) {
    return { theme: null, errors: [`theme "${ref}" not found (bundled themes: ${bundledThemeNames().join(", ")})`], warnings, source: path };
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { theme: null, errors: [`${path}: invalid JSON: ${e.message}`], warnings, source: path };
  }
  if (!validateSchema(raw)) {
    for (const e of validateSchema.errors) {
      const field = (e.instancePath || "/").slice(1).replaceAll("/", ".") || "(root)";
      const detail = e.keyword === "pattern" && e.instancePath.includes("colors")
        ? `must be a color like "#1F2328"`
        : e.keyword === "additionalProperties" ? `unknown field "${e.params.additionalProperty}"` : e.message;
      errors.push(`${field}: ${detail}`);
    }
    return { theme: null, errors, warnings, source: path };
  }

  const defaults = JSON.parse(readFileSync(join(THEMES_DIR, `${DEFAULT_THEME}.json`), "utf8"));
  delete defaults.$schema;
  const theme = deepMerge(defaults, raw);
  delete theme.$schema;
  if (!raw.name) theme.name = path === bundledThemePath(DEFAULT_THEME) ? DEFAULT_THEME : "custom";
  theme.baseDir = dirname(path);

  // Font files given by the theme
  theme.fonts.files = (raw.fonts?.files ?? []).map((f) => ({
    family: f.family,
    weight: f.weight ?? "normal",
    style: f.style ?? "normal",
    path: resolve(theme.baseDir, f.path),
  }));
  for (const f of theme.fonts.files) {
    if (!existsSync(f.path)) errors.push(`fonts.files: file not found: ${f.path}`);
    else if (!/\.(ttf|otf|woff2?)$/i.test(f.path)) errors.push(`fonts.files: ${f.path} must be a .ttf, .otf, .woff or .woff2 file`);
  }
  const webOnly = [...new Set(theme.fonts.files.filter((f) => /\.woff2?$/i.test(f.path)).map((f) => f.family))]
    .filter((family) => !theme.fonts.files.some((f) => f.family === family && /\.(ttf|otf)$/i.test(f.path)));
  for (const family of webOnly)
    warnings.push(`fonts.files: "${family}" has only WOFF/WOFF2 files; the PDF uses them, but Word cannot embed them, so the DOCX shows "${family}" only where it is installed (add .ttf or .otf files to embed it)`);
  for (const role of ["heading", "body", "mono"]) {
    const family = theme.fonts[role];
    if (!fontAvailable(theme, family))
      warnings.push(`fonts.${role}: "${family}" is not bundled and has no file in fonts.files; viewers will use their default font`);
  }

  if (theme.cover.logo) {
    theme.cover.logo = resolve(theme.baseDir, theme.cover.logo);
    if (!existsSync(theme.cover.logo)) errors.push(`cover.logo: file not found: ${theme.cover.logo}`);
    else if (!/\.(png|jpe?g)$/i.test(theme.cover.logo)) errors.push("cover.logo: must be a PNG or JPEG file");
  }

  for (const r of CONTRAST_RULES) {
    const fg = theme.colors[r.fg], bg = theme.colors[r.bg];
    const ratio = contrastRatio(fg, bg);
    if (ratio < r.min) {
      errors.push(
        `colors.${r.fg} ${fg} on colors.${r.bg} ${bg} has contrast ${ratio.toFixed(2)}:1, below ${r.min}:1 for ${r.use}` +
          ` (nearest passing: ${nearestPassingColor(fg, bg, r.min)})`,
      );
    }
  }
  return { theme: errors.length ? null : theme, errors, warnings, source: path };
}

export function fontAvailable(theme, family) {
  return Boolean(BUNDLED_FONTS[family] || GENERIC_FONTS[family] || theme.fonts.files?.some((f) => f.family === family));
}

/** Face files for a family: bundled or from the theme. Missing faces are undefined. */
export function fontFaces(theme, family) {
  if (BUNDLED_FONTS[family]) return BUNDLED_FONTS[family];
  const files = (theme.fonts.files ?? []).filter((f) => f.family === family);
  const pick = (w, s) => files.find((f) => f.weight === w && f.style === s)?.path;
  return { regular: pick("normal", "normal"), bold: pick("bold", "normal"), italic: pick("normal", "italic"), boldItalic: pick("bold", "italic") };
}

/** Name Office files should use for a theme font (generic CSS families map to common Office fonts). */
export function officeFont(family) {
  return GENERIC_FONTS[family] ?? family;
}

/**
 * Office accent colors 2–6: from the theme, or derived from the accent by rotating the hue and
 * adjusting lightness until each reaches 3:1 against the background.
 */
export function officeAccents(theme) {
  if (theme.office?.accents) return theme.office.accents;
  const [h, s, l] = rgbToHsl(hexToRgb(theme.colors.accent));
  return [1, 2, 3, 4, 5].map((i) => {
    const c = rgbToHex(hslToRgb([(h + i * 60) % 360, Math.max(s, 0.35), l]));
    return contrastRatio(c, theme.colors.background) >= 3 ? c : nearestPassingColor(c, theme.colors.background, 3);
  });
}
