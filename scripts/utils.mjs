import fs from "node:fs";
import path from "node:path";

export function toPosix(file) {
  return file.split("\\").join("/");
}

export function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function readUtf8(file) {
  return fs.readFileSync(file, "utf8");
}

export function hasBom(file) {
  const bytes = fs.readFileSync(file);
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

export function section(text, heading) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return "";
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n").trim();
}

export function realPathInside(file, root) {
  try {
    const real = fs.realpathSync.native(file);
    return isInside(root, real) ? real : "";
  } catch {
    return "";
  }
}

export function isReadableFileInside(file, root) {
  const real = realPathInside(file, root);
  if (!real) return false;
  try {
    return fs.statSync(real).isFile();
  } catch {
    return false;
  }
}

const defaultSkipDirs = new Set([".git", "node_modules", ".dev-memory-ops"]);

export function walkMd(dir, root, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (defaultSkipDirs.has(entry.name)) continue;
      walkMd(full, root, out);
    } else if (entry.isFile() && entry.name.endsWith(".md") && isReadableFileInside(full, root)) {
      out.push(full);
    }
  }
  return out;
}

export function walkAll(dir, skipDirs = defaultSkipDirs, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      walkAll(full, skipDirs, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

export function resolveMemoryRoot(rawPath) {
  const root = path.resolve(rawPath);
  let realRoot;
  try {
    realRoot = fs.realpathSync.native(root);
  } catch {
    return null;
  }
  if (!fs.statSync(realRoot).isDirectory()) return null;
  return realRoot;
}
