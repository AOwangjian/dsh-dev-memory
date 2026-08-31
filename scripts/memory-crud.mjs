import fs from "node:fs";
import path from "node:path";
import { toPosix, isInside, readUtf8, section, isReadableFileInside, walkMd, resolveMemoryRoot } from "./utils.mjs";

// Deterministic CRUD helper for dev-memory write-path.
// Read-only: validates / dedup-checks / index-checks. Never writes memory files.
// Subcommands: validate <root> <file> | dup-check <root> <file> | index-sync <root> [--check]

const usage =
  'Usage: node memory-crud.mjs <validate|dup-check|index-sync> <memory-root> [file] [--json] [--soft-lines N] [--split-lines N] [--max-lines N]';

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(usage);
  process.exit(0);
}

const sub = argv[0];
const memoryRoot = argv[1];
const rest = argv.slice(2);

function fail(message) {
  console.error(message);
  console.error(usage);
  process.exit(2);
}

if (!sub || !["validate", "dup-check", "index-sync"].includes(sub)) {
  fail(`Unknown or missing subcommand: ${sub ?? "(none)"}`);
}
if (!memoryRoot) fail("Missing memory-root");

const outputJson = rest.includes("--json");

function flagValue(name, fallback) {
  const i = rest.indexOf(name);
  if (i < 0) return fallback;
  const v = rest[i + 1];
  if (!v || v.startsWith("--")) fail(`Invalid ${name}: expected a value`);
  return v;
}

const softLines = Number.parseInt(flagValue("--soft-lines", "300"), 10);
const splitLines = Number.parseInt(flagValue("--split-lines", "500"), 10);
const maxLines = Number.parseInt(flagValue("--max-lines", "800"), 10);
if (!Number.isSafeInteger(softLines) || softLines <= 0) fail("Invalid --soft-lines");
if (!Number.isSafeInteger(splitLines) || splitLines <= 0) fail("Invalid --split-lines");
if (!Number.isSafeInteger(maxLines) || maxLines <= 0) fail("Invalid --max-lines");
if (!(softLines < splitLines && splitLines < maxLines)) {
  fail("Line thresholds must satisfy --soft-lines < --split-lines < --max-lines");
}

const positional = rest.filter((a) => !a.startsWith("--"));
const fileArg = positional[0];

const realRoot = resolveMemoryRoot(memoryRoot);
if (!realRoot) fail(`Invalid memory-root: ${memoryRoot}`);
const root = realRoot;

function localLinks(file, text) {
  const dir = path.dirname(file);
  const out = [];
  const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;
  let m;
  while ((m = linkRe.exec(text))) {
    const raw = m[1].replace(/^<|>$/g, "").split("#")[0].trim();
    if (!raw || /^[a-z]+:/i.test(raw) || raw.startsWith("mailto:")) continue;
    if (!raw.endsWith(".md")) continue;
    out.push({ raw, resolved: path.resolve(dir, raw) });
  }
  return out;
}

function isIndexFile(rel) {
  const base = path.basename(rel).toLowerCase();
  return base === "readme.md" || base === "memory.md";
}

// ---- validate ----
function validateFile(rel) {
  const abs = path.resolve(root, rel);
  if (!isInside(root, abs)) fail(`Path escapes memory root: ${rel}`);
  if (!isReadableFileInside(abs, root)) fail(`File not found: ${rel}`);
  const text = readUtf8(abs);
  const lines = text.split(/\r?\n/).length;
  const errors = [];
  const warnings = [];

  for (const link of localLinks(abs, text)) {
    if (!isInside(root, link.resolved) || !isReadableFileInside(link.resolved, root)) {
      errors.push(`broken link: ${link.raw}`);
    }
  }

  if (lines > maxLines) {
    errors.push(`too long: ${lines} lines > hard cap ${maxLines}`);
  } else if (lines > splitLines) {
    warnings.push(`over split threshold: ${lines}/${splitLines}; consider sub-docs or archiving old details`);
  } else if (lines > softLines) {
    warnings.push(`over soft line threshold: ${lines}/${softLines}; prune before appending if possible`);
  } else if (lines >= softLines - 50) {
    warnings.push(`near soft line threshold: ${lines}/${softLines}`);
  }

  if (!isIndexFile(rel)) {
    for (const key of ["状态", "证据来源", "最近验证"]) {
      if (!new RegExp(`^>\\s*${key}\\s*:`, "m").test(text)) {
        warnings.push(`missing frontmatter: > ${key}:`);
      }
    }
    if (!/^##\s+快速判断\s*$/m.test(text)) warnings.push("missing section: ## 快速判断");
    if (!/^##\s+关联记忆\s*$/m.test(text)) warnings.push("missing section: ## 关联记忆");
    if (!/^##\s+待验证\s*$/m.test(text)) warnings.push("missing section: ## 待验证");
  }

  return { file: rel, lines, errors, warnings, ok: errors.length === 0 };
}

// ---- dup-check ----
function indexBlock(text) {
  const idx = section(text, "检索索引");
  const fence = idx.match(/```(?:yaml|yml)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : idx;
  const terms = new Set();
  let inList = false;
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^(keywords|aliases)\s*:\s*$/.test(line)) {
      inList = true;
      continue;
    }
    if (/^[A-Za-z][A-Za-z0-9_-]*\s*:\s*$/.test(line)) {
      inList = false;
      continue;
    }
    const item = line.match(/^-\s*(.+)$/);
    if (item && inList) terms.add(item[1].replace(/^["']|["']$/g, "").trim().toLowerCase());
  }
  return terms;
}

function titleTerms(rel, text) {
  const terms = new Set();
  const h1 = text.split(/\r?\n/).find((l) => /^#\s+/.test(l));
  if (h1) {
    for (const w of h1.replace(/^#\s+/, "").matchAll(/[㐀-鿿]{2,}|[a-z0-9]{3,}/gi)) {
      terms.add(w[0].toLowerCase());
    }
  }
  const base = path.basename(rel, ".md");
  for (const w of base.split(/[-_]/)) if (w.length >= 2) terms.add(w.toLowerCase());
  return terms;
}

function dupCheck(rel) {
  const abs = path.resolve(root, rel);
  if (!isReadableFileInside(abs, root)) fail(`File not found: ${rel}`);
  const text = readUtf8(abs);
  const target = new Set([...indexBlock(text), ...titleTerms(rel, text)]);
  if (target.size === 0) {
    return { file: rel, targetTerms: 0, note: "no keywords/title terms to compare", suspects: [] };
  }
  const suspects = [];
  for (const f of walkMd(root, root)) {
    const otherRel = toPosix(path.relative(root, f));
    if (otherRel === rel || isIndexFile(otherRel)) continue;
    const otherText = readUtf8(f);
    const otherIdx = [...indexBlock(otherText)].join(" ");
    const otherH1 = otherText.split(/\r?\n/).find((l) => /^#\s+/.test(l)) ?? "";
    const hay = `${otherIdx} ${otherH1} ${section(otherText, "快速判断")}`.toLowerCase();
    let hits = 0;
    const matched = [];
    for (const t of target) {
      if (t && hay.includes(t)) {
        hits++;
        matched.push(t);
      }
    }
    const ratio = hits / target.size;
    if (hits >= 2 && ratio >= 0.4) {
      suspects.push({ file: otherRel, hits, ratio: Number(ratio.toFixed(2)), matched });
    }
  }
  suspects.sort((a, b) => b.ratio - a.ratio || b.hits - a.hits);
  return { file: rel, targetTerms: target.size, suspects: suspects.slice(0, 5) };
}

// ---- index-sync ----
function indexSync() {
  const all = walkMd(root, root).map((f) => toPosix(path.relative(root, f)));
  const allSet = new Set(all);
  const linked = new Set();
  const broken = [];

  for (const rel of all) {
    if (!isIndexFile(rel)) continue;
    const abs = path.resolve(root, rel);
    for (const link of localLinks(abs, readUtf8(abs))) {
      const targetRel = toPosix(path.relative(root, link.resolved));
      if (isInside(root, link.resolved) && allSet.has(targetRel)) {
        linked.add(targetRel);
      } else {
        broken.push({ from: rel, link: link.raw });
      }
    }
  }

  const orphans = all.filter((rel) => {
    if (isIndexFile(rel)) return false;
    return !linked.has(rel);
  });

  return { totalFiles: all.length, indexedTargets: linked.size, orphans, brokenLinks: broken };
}

// ---- dispatch ----
let result;
let hasError = false;

if (sub === "validate") {
  if (!fileArg) fail("validate requires <file> (relative to memory-root)");
  result = validateFile(fileArg);
  hasError = !result.ok;
} else if (sub === "dup-check") {
  if (!fileArg) fail("dup-check requires <file> (relative to memory-root)");
  result = dupCheck(fileArg);
  hasError = false;
} else if (sub === "index-sync") {
  result = indexSync();
  hasError = result.brokenLinks.length > 0;
}

const payload = { subcommand: sub, memoryRoot: root, result };

if (outputJson) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log(`# memory-crud ${sub}`);
  console.log(`- memory-root: ${root}`);
  if (sub === "validate") {
    console.log(`- file: ${result.file} (${result.lines} lines)`);
    console.log(`- ok: ${result.ok}`);
    for (const e of result.errors) console.log(`  [error] ${e}`);
    for (const w of result.warnings) console.log(`  [warn]  ${w}`);
  } else if (sub === "dup-check") {
    console.log(`- file: ${result.file} (target terms: ${result.targetTerms ?? 0})`);
    if (!result.suspects || result.suspects.length === 0) console.log("  no suspected duplicates");
    for (const s of result.suspects ?? []) {
      console.log(`  [suspect] ${s.file} ratio=${s.ratio} hits=${s.hits} matched=${s.matched.join(",")}`);
    }
  } else {
    console.log(`- total files: ${result.totalFiles}, indexed targets: ${result.indexedTargets}`);
    if (result.orphans.length === 0) console.log("  no orphans");
    for (const o of result.orphans) console.log(`  [orphan] ${o}`);
    for (const b of result.brokenLinks) console.log(`  [broken] ${b.from} -> ${b.link}`);
  }
}

process.exit(hasError ? 1 : 0);
