import fs from "node:fs";
import path from "node:path";
import { toPosix, isInside, readUtf8, section, realPathInside, isReadableFileInside, walkMd } from "./utils.mjs";

const rawArgs = process.argv.slice(2);
const memoryRoot = rawArgs[0];
const queryRaw = rawArgs[1];
const args = rawArgs.slice(2);
const usage = 'Usage: node search-memory.mjs <memory-root> "<query>" [--top 5] [--json] [--explain] [--help]';

function fail(message) {
  console.error(message);
  console.error(usage);
  process.exit(2);
}

function parseArgs() {
  let top = 5;
  let outputJson = false;
  let explain = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help") {
      console.log(usage);
      process.exit(0);
    }
    if (arg === "--json") {
      outputJson = true;
      continue;
    }
    if (arg === "--explain") {
      explain = true;
      continue;
    }
    if (arg === "--top") {
      const value = args[i + 1];
      if (!value || value.startsWith("--") || !/^[1-9]\d*$/.test(value)) {
        fail("Invalid --top: expected a positive integer");
      }
      top = Number.parseInt(value, 10);
      if (!Number.isSafeInteger(top)) {
        fail("Invalid --top: expected a safe positive integer");
      }
      i++;
      continue;
    }
    if (arg.startsWith("--")) {
      fail(`Unknown option: ${arg}`);
    }
    fail(`Unexpected argument: ${arg}`);
  }

  return { top, outputJson, explain: explain || outputJson };
}

if (rawArgs.length === 1 && rawArgs[0] === "--help") {
  console.log(usage);
  process.exit(0);
}

if (!memoryRoot || queryRaw === undefined) {
  fail("Missing memory-root or query");
}

const query = queryRaw.trim();
if (!query) {
  fail("Invalid query: expected non-empty text");
}

const { top, outputJson, explain } = parseArgs();
const root = path.resolve(memoryRoot);
let realRoot;

try {
  realRoot = fs.realpathSync.native(root);
} catch {
  fail(`Invalid memory-root: ${memoryRoot}`);
}

if (!fs.statSync(realRoot).isDirectory()) {
  fail(`Invalid memory-root: ${memoryRoot}`);
}

function headings(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => /^#{1,6}\s+/.test(line))
    .join("\n");
}

function parseSimpleYamlListBlock(text) {
  const indexSection = section(text, "检索索引");
  const fence = indexSection.match(/```(?:yaml|yml)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : indexSection;
  const data = { keywords: [], aliases: [], entrypoints: [], related: [] };
  let current = "";
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    const key = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*$/);
    if (key) {
      current = Object.prototype.hasOwnProperty.call(data, key[1]) ? key[1] : "";
      continue;
    }
    const item = line.match(/^-\s*(.+)$/);
    if (item && current) {
      data[current].push(item[1].replace(/^["']|["']$/g, "").trim());
    }
  }
  return data;
}

function tableLike(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.includes("|") && /文件|入口|职责|\.lua|\.md|Controller|Manager|Panel|View/.test(line))
    .join("\n");
}

function pitfallText(text) {
  return [
    section(text, "踩坑记录"),
    section(text, "已知问题"),
    section(text, "待验证"),
  ].filter(Boolean).join("\n");
}

function readmeLinks(readmeFile, text) {
  const rows = [];
  const dir = path.dirname(readmeFile);
  const linkRe = /\[([^\]]+)\]\(([^)]+\.md(?:#[^)]+)?)\)/g;
  let match;
  while ((match = linkRe.exec(text))) {
    const targetRaw = match[2].replace(/^<|>$/g, "").split("#")[0];
    if (/^[a-z]+:/i.test(targetRaw)) continue;
    const target = path.resolve(dir, targetRaw);
    if (!isReadableFileInside(target, realRoot)) continue;
    rows.push({
      target: toPosix(path.relative(root, target)),
      text: surroundingLine(text, match.index),
    });
  }
  return rows;
}

function surroundingLine(text, index) {
  const before = text.lastIndexOf("\n", index);
  const after = text.indexOf("\n", index);
  return text.slice(before < 0 ? 0 : before + 1, after < 0 ? text.length : after).trim();
}

function cjkNgrams(segment) {
  const terms = [];
  for (let size = 2; size <= 6; size++) {
    for (let i = 0; i <= segment.length - size; i++) {
      terms.push(segment.slice(i, i + size));
    }
  }
  return terms;
}

function queryTerms(input) {
  const terms = new Set();
  const lower = input.toLowerCase();
  terms.add(lower.trim());

  for (const match of lower.matchAll(/[a-z0-9_./-]{2,}/g)) terms.add(match[0]);
  for (const match of lower.matchAll(/\d{2,}/g)) terms.add(match[0]);
  for (const match of input.matchAll(/[\u3400-\u9fff\uf900-\ufaff]{2,}/g)) {
    const segment = match[0];
    if (segment.length <= 6) terms.add(segment);
    for (const term of cjkNgrams(segment)) terms.add(term);
  }

  return [...terms].filter((term) => term.length >= 2);
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

function isShortCjkTerm(term) {
  return term.length < 3 && /^[\u3400-\u9fff\uf900-\ufaff]+$/.test(term);
}

function loadDocs() {
  const files = walkMd(root, realRoot);
  const docs = new Map();

  for (const file of files) {
    if (!isReadableFileInside(file, realRoot)) continue;
    const rel = toPosix(path.relative(root, file));
    const text = readUtf8(file);
    const searchIndex = parseSimpleYamlListBlock(text);
    docs.set(rel, {
      rel,
      file,
      text,
      fields: {
        path: rel,
        index: [...searchIndex.keywords, ...searchIndex.aliases].join("\n"),
        entrypoints: searchIndex.entrypoints.join("\n"),
        related: searchIndex.related.join("\n"),
        readmeIndex: "",
        headings: headings(text),
        quick: section(text, "快速判断"),
        fileTable: tableLike(text),
        pitfalls: pitfallText(text),
        body: text,
      },
    });
  }

  for (const doc of docs.values()) {
    if (path.basename(doc.rel).toLowerCase() !== "readme.md") continue;
    for (const link of readmeLinks(doc.file, doc.text)) {
      const target = docs.get(link.target);
      if (target) target.fields.readmeIndex += `${link.text}\n`;
    }
  }

  return [...docs.values()];
}

const weights = {
  path: 100,
  index: 90,
  entrypoints: 85,
  readmeIndex: 75,
  headings: 60,
  quick: 55,
  fileTable: 50,
  pitfalls: 45,
  body: 10,
};

const sourceNames = {
  path: "path",
  index: "keywords/aliases",
  entrypoints: "entrypoints",
  readmeIndex: "README index",
  headings: "heading",
  quick: "quick judgment",
  fileTable: "file table",
  pitfalls: "pitfall",
  body: "body",
};

function scoreDoc(doc, terms) {
  let score = 0;
  const matched = [];
  const strongSources = new Set();
  const contextSources = new Set();

  for (const [field, raw] of Object.entries(doc.fields)) {
    if (!raw) continue;
    const haystack = raw.toLowerCase();
    for (const term of terms) {
      const normalizedTerm = term.toLowerCase();
      if (field === "body" && isShortCjkTerm(normalizedTerm)) continue;
      const count = countOccurrences(haystack, normalizedTerm);
      if (count <= 0) continue;
      const capped = Math.min(count, field === "body" ? 3 : 5);
      const points = capped * weights[field];
      score += points;
      matched.push({ term, source: sourceNames[field], count, weight: points });
      if (["path", "index", "entrypoints"].includes(field)) strongSources.add(field);
      if (["readmeIndex", "headings", "quick", "fileTable", "pitfalls"].includes(field)) contextSources.add(field);
    }
  }

  return {
    score,
    confidence: confidence(score, strongSources.size, contextSources.size),
    matched: compactMatches(matched),
  };
}

function confidence(score, strongCount, contextCount) {
  if (strongCount >= 2) return "high";
  if (strongCount >= 1 && (score >= 160 || contextCount >= 1)) return "high";
  if (strongCount >= 1 || contextCount >= 2 || score >= 120) return "medium";
  if (score > 0) return "low";
  return "none";
}

function compactMatches(matches) {
  const best = new Map();
  for (const item of matches) {
    const key = `${item.term}:${item.source}`;
    const prev = best.get(key);
    if (!prev || item.weight > prev.weight) best.set(key, item);
  }
  return [...best.values()]
    .sort((a, b) => b.weight - a.weight || b.term.length - a.term.length || a.term.localeCompare(b.term))
    .slice(0, explain ? 12 : 6);
}

function suggestedRead(rel, relSet) {
  if (path.basename(rel).toLowerCase() === "readme.md") return [rel];
  const dirParts = path.dirname(rel).split("/");
  const candidates = [];
  for (let i = dirParts.length; i >= 1; i--) {
    const readme = `${dirParts.slice(0, i).join("/")}/README.md`;
    if (relSet.has(readme)) {
      candidates.push(readme);
      break;
    }
  }
  candidates.push(rel);
  return [...new Set(candidates)];
}

const docs = loadDocs();
const relSet = new Set(docs.map((doc) => doc.rel));
const terms = queryTerms(query);
const ranked = docs
  .map((doc) => {
    const scored = scoreDoc(doc, terms);
    return {
      file: doc.rel,
      score: scored.score,
      confidence: scored.confidence,
      matched: scored.matched,
      suggestedRead: suggestedRead(doc.rel, relSet),
    };
  })
  .filter((row) => row.score > 0)
  .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
  .slice(0, top);

if (outputJson) {
  console.log(JSON.stringify({ query, terms, results: ranked }, null, 2));
} else {
  console.log(`Query: ${query}`);
  console.log(`Terms: ${terms.join(", ")}`);
  console.log("Top results:");
  if (ranked.length === 0) {
    console.log("- no hit");
  }
  ranked.forEach((row, index) => {
    console.log(`${index + 1}. ${row.file} score=${row.score} confidence=${row.confidence}`);
    console.log(`   matched: ${row.matched.map((item) => `${item.term}(${item.source})`).join(", ")}`);
    console.log(`   suggested-read: ${row.suggestedRead.join(", ")}`);
  });
}
