import fs from "node:fs";
import path from "node:path";
import { isInside, readUtf8, hasBom, walkAll } from "./utils.mjs";

const usage = "Usage: node health-check.mjs <memory-root> [--json] [--help]";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(usage);
  process.exit(0);
}

const memoryRoot = process.argv[2];
const outputJson = process.argv.includes("--json");

if (!memoryRoot) {
  console.error(usage);
  process.exit(2);
}

if (!fs.existsSync(memoryRoot) || !fs.statSync(memoryRoot).isDirectory()) {
  console.error(`Invalid memory-root: ${memoryRoot}`);
  process.exit(2);
}

function walkDirs(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    out.push(full);
    walkDirs(full, out);
  }
  return out;
}

function rel(file) {
  return path.relative(memoryRoot, file).split("\\").join("/");
}

function checkMarkdownLinks(file, text) {
  const broken = [];
  const duplicates = [];
  const seen = new Set();
  const linkRe = /\[[^\]]+\]\(([^)]+\.md(?:#[^)]+)?)\)/g;
  let match;
  while ((match = linkRe.exec(text))) {
    const rawTarget = match[1].replace(/^<|>$/g, "");
    const target = rawTarget.split("#")[0];
    if (/^[a-z]+:/i.test(target)) continue;
    const key = `${rel(file)} -> ${rawTarget}`;
    if (seen.has(key)) duplicates.push({ file: rel(file), target: rawTarget });
    seen.add(key);
    const resolved = path.resolve(path.dirname(file), target);
    if (!isInside(memoryRoot, resolved) || !fs.existsSync(resolved)) {
      broken.push({ file: rel(file), target: rawTarget });
    }
  }
  return { broken, duplicates };
}

const skipDirs = new Set([".git", "node_modules"]);
const files = walkAll(memoryRoot, skipDirs);
const mdFiles = files.filter((file) => file.endsWith(".md"));
const dirs = [memoryRoot, ...walkDirs(memoryRoot)].filter((dir) => isInside(memoryRoot, dir));

const issues = {
  missingReadmeDirs: [],
  overlongFiles: [],
  missingMeta: [],
  missingQuickJudgment: [],
  missingAssociatedMemory: [],
  missingPendingVerification: [],
  oldLineTables: [],
  pendingEntrypoints: [],
  brokenLinks: [],
  duplicateLinks: [],
  sameNameMdAndDir: [],
  bomFiles: [],
  replacementCharFiles: [],
};

for (const dir of dirs) {
  if (dir === memoryRoot) continue;
  if (!fs.existsSync(path.join(dir, "README.md"))) issues.missingReadmeDirs.push(rel(dir));
}

const dirNames = new Set(dirs.map((dir) => rel(dir)));

for (const file of mdFiles) {
  const text = readUtf8(file);
  const relative = rel(file);
  const lines = text.split(/\r?\n/);
  if (hasBom(file)) issues.bomFiles.push(relative);
  if (text.includes(String.fromCharCode(0xFFFD))) issues.replacementCharFiles.push(relative);
  if (lines.length > 800) {
    issues.overlongFiles.push({ file: relative, lines: lines.length, suggestion: "超过 800 行，必须拆分、归档旧内容或停止追加" });
  } else if (lines.length > 500) {
    issues.overlongFiles.push({ file: relative, lines: lines.length, suggestion: "超过 500 行，建议拆子文档或下沉细节" });
  } else if (lines.length > 300) {
    issues.overlongFiles.push({ file: relative, lines: lines.length, suggestion: "超过 300 行软提醒，追加前先精简" });
  } else if (lines.length >= 250) {
    issues.overlongFiles.push({ file: relative, lines: lines.length, suggestion: "接近 300 行软提醒线，后续更新前留意" });
  }
  for (const meta of ["状态:", "证据来源:", "最近验证:"]) {
    if (!text.includes(`> ${meta}`)) issues.missingMeta.push({ file: relative, meta });
  }
  if (!/^## 快速判断$/m.test(text)) issues.missingQuickJudgment.push(relative);
  if (!/^## 关联记忆$/m.test(text)) issues.missingAssociatedMemory.push(relative);
  if (!/^## 待验证$/m.test(text)) issues.missingPendingVerification.push(relative);
  if (/\|\s*文件\s*\|\s*行数\s*\|\s*职责\s*\|/.test(text)) issues.oldLineTables.push(relative);
  if (/\|\s*`[^`]+`\s*\|\s*`[^`]+`\s*\|\s*`?待确认`?\s*\|/.test(text)) issues.pendingEntrypoints.push(relative);

  const linkIssues = checkMarkdownLinks(file, text);
  issues.brokenLinks.push(...linkIssues.broken);
  issues.duplicateLinks.push(...linkIssues.duplicates);

  if (relative.endsWith(".md")) {
    const noExt = relative.slice(0, -3);
    if (dirNames.has(noExt)) issues.sameNameMdAndDir.push({ file: relative, directory: noExt });
  }
}

function total(...values) {
  return values.reduce((sum, value) => sum + value.length, 0);
}

const severityCounts = {
  high: total(
    issues.brokenLinks,
    issues.oldLineTables,
    issues.pendingEntrypoints,
    issues.bomFiles,
    issues.replacementCharFiles,
    issues.missingReadmeDirs,
  ),
  medium: total(issues.overlongFiles, issues.sameNameMdAndDir),
  low: total(issues.missingAssociatedMemory, issues.missingPendingVerification, issues.duplicateLinks, issues.missingMeta),
};

const summary = {
  memoryRoot,
  markdownFiles: mdFiles.length,
  directories: dirs.length - 1,
  readmes: mdFiles.filter((file) => path.basename(file) === "README.md").length,
  memoryIndexExists: fs.existsSync(path.join(memoryRoot, "MEMORY.md")),
  severityCounts,
};

const report = { summary, issues };

function count(value) {
  return Array.isArray(value) ? value.length : 0;
}

function printList(title, values, format = (value) => `- ${value}`) {
  console.log(`\n## ${title}`);
  if (values.length === 0) {
    console.log("- 无");
    return;
  }
  for (const value of values) console.log(format(value));
}

if (outputJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("# Dev Memory 健康检查报告");
  console.log("\n## 总览");
  console.log(`- memory 根目录: ${summary.memoryRoot}`);
  console.log(`- Markdown 文件数: ${summary.markdownFiles}`);
  console.log(`- 目录数: ${summary.directories}`);
  console.log(`- README 数: ${summary.readmes}`);
  console.log(`- MEMORY.md: ${summary.memoryIndexExists ? "存在" : "缺失"}`);
  console.log(`- 高优先级问题: ${summary.severityCounts.high}`);
  console.log(`- 中优先级问题: ${summary.severityCounts.medium}`);
  console.log(`- 低优先级问题: ${summary.severityCounts.low}`);

  console.log("\n## 问题计数");
  for (const [key, value] of Object.entries(issues)) {
    console.log(`- ${key}: ${count(value)}`);
  }

  printList("高优先级问题", [
    ...issues.brokenLinks.map((item) => `断链: ${item.file} -> ${item.target}`),
    ...issues.oldLineTables.map((item) => `旧行号表: ${item}`),
    ...issues.pendingEntrypoints.map((item) => `入口待确认: ${item}`),
    ...issues.bomFiles.map((item) => `UTF-8 BOM: ${item}`),
    ...issues.replacementCharFiles.map((item) => `疑似乱码: ${item}`),
  ]);

  printList("超长或待拆分", issues.overlongFiles, (item) => `- ${item.file}: ${item.lines} 行，${item.suggestion}`);
  printList("缺少 README 的目录", issues.missingReadmeDirs);
  printList("同名 md 与目录", issues.sameNameMdAndDir, (item) => `- ${item.file} / ${item.directory}`);
  printList("缺少关联记忆章节", issues.missingAssociatedMemory);
  printList("缺少待验证章节", issues.missingPendingVerification);
}
