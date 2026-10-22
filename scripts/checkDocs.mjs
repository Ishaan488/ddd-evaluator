#!/usr/bin/env node
/**
 * Keeps the documentation honest. Checks that
 *   1. every relative link and image in the Markdown files points at a file that exists,
 *   2. every #anchor points at a heading that exists (GitHub's slug rules),
 *   3. every repository path written in backticks exists,
 *   4. every folder tree drawn in a code block matches the real folders,
 *   5. every Mermaid block marked `%% source: <file>` is identical to that file.
 * Run:  npm run docs:check
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const fail = (file, message) => problems.push(`${path.relative(root, file)}: ${message}`);

function markdownFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (['node_modules', 'dist', '.git', 'data'].includes(name)) return [];
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return markdownFiles(full);
    return name.endsWith('.md') ? [full] : [];
  });
}

/** Splits a file into prose lines and fenced code blocks. */
function parse(text) {
  const prose = [];
  const blocks = [];
  let fence = null;
  for (const line of text.split('\n')) {
    const marker = /^\s*```(\w*)/.exec(line);
    if (marker) {
      if (fence) {
        blocks.push(fence);
        fence = null;
      } else {
        fence = { lang: marker[1], lines: [] };
      }
      continue;
    }
    if (fence) fence.lines.push(line);
    else prose.push(line);
  }
  return { prose, blocks };
}

const slug = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');

const anchorCache = new Map();
function anchorsOf(file) {
  if (anchorCache.has(file)) return anchorCache.get(file);
  const seen = new Map();
  const anchors = new Set();
  for (const line of parse(readFileSync(file, 'utf8')).prose) {
    const match = /^#{1,6}\s+(.*)$/.exec(line);
    if (!match) continue;
    const base = slug(match[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'));
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }
  anchorCache.set(file, anchors);
  return anchors;
}

const REPO_PREFIX = /^(server|shared|web|docs|samples|scripts)\//;
const SERVER_SRC = /^(agent|api|db|excel|llm|report|scorecard|util)\/[\w./-]+$/;

function checkPath(file, token) {
  if (/[\s*<>{}$|]|\.\.\.|…/.test(token)) return;
  if (REPO_PREFIX.test(token) || ['docker-compose.yml', '.env.example', '.nvmrc', 'README.md', 'CHANGELOG.md'].includes(token)) {
    if (!existsSync(path.join(root, token))) fail(file, `path \`${token}\` does not exist`);
  } else if (SERVER_SRC.test(token)) {
    if (!existsSync(path.join(root, 'server/src', token))) fail(file, `path \`${token}\` does not exist under server/src`);
  }
}

/**
 * Parses a drawn tree into repo-relative paths. The first line without a branch glyph names the root
 * ("ddd/" is the repository itself; "server/src/agent/" is a sub-folder). Three or more spaces start a
 * comment; several names may share a line when separated by one or two spaces.
 */
function treePaths(lines) {
  const out = [];
  const stack = [];
  let base = '';
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const glyph = line.search(/[├└]/);
    if (glyph === -1) {
      const first = line.trim().split(/\s{2,}/)[0];
      if (/^[\w./-]+\/$/.test(first)) base = first === 'ddd/' ? '' : first.replace(/\/$/, '');
      continue;
    }
    const depth = Math.floor(glyph / 4);
    const text = line.slice(glyph).replace(/^[├└]── /, '');
    // Three or more spaces start a comment. Up to that point, names are separated by single or double spaces.
    const names = [];
    for (const token of text.split(/\s{3,}/)[0].split(/\s+/)) {
      if (/^[\w.@/-]+\/?$/.test(token)) names.push(token.replace(/\/$/, ''));
      else break;
    }
    if (names.length === 0) continue;
    stack.length = depth;
    for (const name of names) out.push([base, ...stack, name].filter(Boolean).join('/'));
    if (names.length === 1) stack.push(names[0]);
  }
  return out;
}

for (const file of markdownFiles(root)) {
  const { prose, blocks } = parse(readFileSync(file, 'utf8'));

  prose.forEach((line, i) => {
    for (const match of line.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (/^(https?:|mailto:)/.test(target)) continue;
      const [rel, hash] = target.split('#');
      const dest = rel === '' ? file : path.resolve(path.dirname(file), rel);
      if (!existsSync(dest)) {
        fail(file, `line ${i + 1}: link target \`${target}\` does not exist`);
        continue;
      }
      if (hash && dest.endsWith('.md') && !anchorsOf(dest).has(hash)) {
        fail(file, `line ${i + 1}: anchor \`#${hash}\` not found in ${path.relative(root, dest)}`);
      }
    }
    for (const match of line.matchAll(/`([^`\n]+)`/g)) checkPath(file, match[1]);
  });

  for (const block of blocks) {
    const marker = block.lang === 'mermaid' ? /^%% source: (\S+)$/.exec(block.lines[0] ?? '') : null;
    if (marker) {
      const sourceFile = path.join(root, marker[1]);
      if (!existsSync(sourceFile)) fail(file, `mermaid source \`${marker[1]}\` does not exist`);
      else if (readFileSync(sourceFile, 'utf8').trimEnd() !== block.lines.slice(1).join('\n').trimEnd()) {
        fail(file, `embedded mermaid block differs from \`${marker[1]}\`; copy the source into the block`);
      }
      continue;
    }
    const looksLikeTree = block.lines.some((l) => /[├└]──/.test(l));
    if (!looksLikeTree) continue;
    for (const p of treePaths(block.lines)) {
      const candidates = [p, `server/src/${p}`];
      if (!candidates.some((c) => existsSync(path.join(root, c)))) fail(file, `tree entry \`${p}\` does not exist`);
    }
  }
}

if (problems.length > 0) {
  console.error(`docs:check found ${problems.length} problem(s):\n` + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log(`docs:check ok: ${markdownFiles(root).length} Markdown files, links, anchors, paths and trees verified.`);
