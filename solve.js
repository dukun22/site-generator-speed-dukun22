// mend-fast site builder: a faster drop-in for makefun-site 1.0.0.
//
// run(input) returns exactly the output tree makefun-site 1.0.0's build returns
// for one case's input, as a JSON object of every path it writes and that file's
// text, byte for byte. Written from the spec (README.md) and the reference
// implementation, restructured for speed: run-based HTML escaping, a fused
// Markdown lexer/renderer, front matter scanned without a full line split, and
// templates compiled once to plain JavaScript functions.

/** The HTML escape table: & < > " ' and nothing else. */
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_RE = /[&<>"']/g;

/** `text` with & < > " and ' escaped. */
export function escapeHtml(text) {
  return text.replace(ESC_RE, (c) => ESCAPES[c]);
}

/** The most characters a slug keeps before a collision suffix. */
export const SLUG_MAX = 64;

/** Slugs, cached: the function is pure and tag names repeat heavily. */
const slugCache = new Map();

/**
 * The slug of `text`: NFKD, combining marks dropped, A-Z lowered, every run of
 * characters other than a-z and 0-9 one "-", none at either end, at most 64
 * characters (a "-" left at the cut dropped), and "untitled" when nothing is left.
 */
export function slugify(text) {
  let out = slugCache.get(text);
  if (out !== undefined) return out;
  const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let s = '';
  let gap = false;
  for (const ch of plain) {
    let keep = null;
    if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
    else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
    if (keep === null) {
      gap = s.length > 0;
      continue;
    }
    if (gap) s += '-';
    gap = false;
    s += keep;
  }
  s = s.slice(0, SLUG_MAX).replace(/-+$/, '');
  out = s === '' ? 'untitled' : s;
  slugCache.set(text, out);
  return out;
}

/** `slug` made unique against `taken` (and added to it): slug, slug-2, slug-3 ... */
export function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Long dates, cached by their string: "2026-11-09" is "9 November 2026". */
const dateCache = new Map();

export function longDate(date) {
  let out = dateCache.get(date);
  if (out === undefined) {
    const [y, m, d] = date.split('-');
    out = `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
    dateCache.set(date, out);
  }
  return out;
}

/** The words of a body: its runs of characters other than whitespace. */
function wordsOf(text) {
  const m = text.match(/\S+/g);
  return m === null ? 0 : m.length;
}

// ---------------------------------------------------------------- front matter

/** The keys a source's front matter may give. */
const FM_KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];

const FM_LINE = /^([a-z_]+):(?: (.*))?$/;
const FM_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FM_NAME = /^[a-z0-9-]+$/;
const FM_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FM_TAG = /^[^"[\]]+$/;

/** The days of month `m` (1-12) of year `y`, by the Gregorian rule. */
function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/** A string value: "..." with \" and \\ its only escapes, or a bare rest of line. */
function stringOf(raw) {
  if (raw[0] === '"') {
    if (raw.length < 2 || raw[raw.length - 1] !== '"') return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw[0] === '[') return { error: 'a bare string opens on [' };
  return { value: raw };
}

/** One key's value, or why it is refused. */
function valueOf(key, raw) {
  if (key === 'title' || key === 'summary') {
    const s = stringOf(raw);
    return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
  }
  if (key === 'date') {
    const m = FM_DATE.exec(raw);
    const y = m ? Number(m[1]) : 0;
    const mo = m ? Number(m[2]) : 0;
    const d = m ? Number(m[3]) : 0;
    if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) {
      return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
    }
    return { value: raw };
  }
  if (key === 'tags') {
    if (raw[0] !== '[' || raw[raw.length - 1] !== ']') return { error: 'key "tags": not a list [a, b]' };
    const inner = raw.slice(1, -1);
    if (inner.trim() === '') return { value: [] };
    const tags = inner.split(',').map((t) => t.trim());
    if (tags.some((t) => t === '' || !FM_TAG.test(t))) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
    return { value: tags };
  }
  if (key === 'draft') {
    if (raw === 'true') return { value: true };
    if (raw === 'false') return { value: false };
    return { error: 'key "draft": true or false' };
  }
  if (key === 'layout') {
    return FM_NAME.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
  }
  if (key === 'slug') {
    return FM_SLUG.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
  }
  return { error: `unknown key "${key}"` };
}

/**
 * A source's front matter and body: { data, body }, or { error } with the first
 * reason it is refused. Scans for the closing line instead of splitting the whole
 * source into lines: the body is one slice, and only the short front-matter
 * region is split.
 */
export function parseFrontMatter(text) {
  if (text.length < 3 || text[0] !== '-' || text[1] !== '-' || text[2] !== '-') return { error: 'no front matter' };
  if (text.length === 3) return { error: 'the front matter is not closed' };
  if (text[3] !== '\n') return { error: 'no front matter' };
  let closeStart = -1;
  const hit = text.indexOf('\n---\n', 3);
  if (hit !== -1) closeStart = hit + 1;
  if (text.endsWith('\n---')) {
    const e = text.length - 3;
    if (closeStart === -1 || e < closeStart) closeStart = e;
  }
  if (closeStart === -1) return { error: 'the front matter is not closed' };
  const fmText = text.slice(4, closeStart - 1);
  const fmLines = fmText === '' ? [] : fmText.split('\n');
  const data = {};
  for (let k = 0; k < fmLines.length; k++) {
    const line = fmLines[k];
    if (/^[ \t]*$/.test(line) || line[0] === '#') continue;
    const m = FM_LINE.exec(line);
    if (!m) return { error: `line ${k + 2} is not "key: value"` };
    const key = m[1];
    const raw = (m[2] ?? '').replace(/[ \t]+$/, '');
    if (!FM_KEYS.includes(key)) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = valueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  let bodyStart = closeStart + 3;
  if (text[bodyStart] === '\n') bodyStart++;
  return { data, body: text.slice(bodyStart) };
}

// ---------------------------------------------------------------- Markdown

/** A line with its spaces and tabs at either end dropped. */
function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b && (line[a] === ' ' || line[a] === '\t')) a++;
  while (b > a && (line[b - 1] === ' ' || line[b - 1] === '\t')) b--;
  return a === 0 && b === line.length ? line : line.slice(a, b);
}

/** Whether `line` holds only spaces and tabs. */
function isBlank(line) {
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== ' ' && line[i] !== '\t') return false;
  }
  return true;
}

/** Whether a character may follow a backtick in a fence language. */
function isLangCh(code) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 95 || code === 43 || code === 45;
}

/** A fence's language, or null when `line` does not open one. */
function fenceLang(line) {
  if (line[0] !== '`' || line[1] !== '`' || line[2] !== '`') return null;
  let i = 3;
  while (i < line.length && isLangCh(line.charCodeAt(i))) i++;
  const lang = line.slice(3, i);
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
  return i === line.length ? lang : null;
}

/** Whether `line` closes a fence: three backticks, then spaces or tabs only. */
function fenceClose(line) {
  if (line[0] !== '`' || line[1] !== '`' || line[2] !== '`') return false;
  for (let i = 3; i < line.length; i++) {
    if (line[i] !== ' ' && line[i] !== '\t') return false;
  }
  return true;
}

/** A heading line's level and text, or null (a heading's text is never empty). */
function headingOf(line) {
  let h = 0;
  while (h < line.length && line[h] === '#') h++;
  if (h === 0 || h > 6) return null;
  if (h >= line.length || (line[h] !== ' ' && line[h] !== '\t')) return null;
  let s = h;
  while (s < line.length && (line[s] === ' ' || line[s] === '\t')) s++;
  let e = line.length;
  while (e > s && (line[e - 1] === ' ' || line[e - 1] === '\t')) e--;
  if (s >= e) return null;
  return { depth: h, text: line.slice(s, e) };
}

/** Whether `line` is a thematic break: --- or *** then spaces or tabs only. */
function isHr(line) {
  let e = line.length;
  while (e > 0 && (line[e - 1] === ' ' || line[e - 1] === '\t')) e--;
  return e === 3 && (line[0] === '-' && line[1] === '-' && line[2] === '-' || line[0] === '*' && line[1] === '*' && line[2] === '*');
}

/** Whether `line` ends a paragraph: blank, a fence, a heading or a break. */
function endsParagraph(line) {
  return isBlank(line) || fenceLang(line) !== null || headingOf(line) !== null || isHr(line);
}

const BULLET = /^[-*] (.*)$/;
const ORDERED = /^(\d{1,9})\. (.*)$/;
const CONTINUED = /^ {2,}\S/;

/** The characters a backslash escapes. */
const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);

/** The first index from `from` where `s` holds `what` outside an escape, or -1. */
function findUnescaped(s, what, from) {
  const wlen = what.length;
  for (let j = from; j <= s.length - wlen; j++) {
    if (s[j] === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

/** The first single * from `from` (one whose run is not **), outside an escape, or -1. */
function findSingleStar(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (c !== '*') continue;
    if (s[j + 1] === '*') {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

/**
 * `s` rendered inline; `env.link(target)` is a link's href. Plain text is
 * gathered into runs and escaped with one regex replace per run, instead of one
 * replace per character; constructs are found with index scans.
 */
export function inline(s, env) {
  let out = '';
  let i = 0;
  let plain = 0;
  const n = s.length;
  const flush = (to) => {
    if (plain < to) out += escapeHtml(s.slice(plain, to));
  };
  while (i < n) {
    const c = s[i];
    if (c === '\\' && i + 1 < n && ESCAPABLE.has(s[i + 1])) {
      flush(i);
      out += escapeHtml(s[i + 1]);
      i += 2;
      plain = i;
      continue;
    }
    if (c === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) {
        flush(i);
        out += `<code>${escapeHtml(s.slice(i + 1, j))}</code>`;
        i = j + 1;
        plain = i;
      } else {
        i++;
      }
      continue;
    }
    if (c === '*') {
      if (s[i + 1] === '*') {
        const j = findUnescaped(s, '**', i + 2);
        if (j > i + 2) {
          flush(i);
          out += `<strong>${inline(s.slice(i + 2, j), env)}</strong>`;
          i = j + 2;
          plain = i;
        } else {
          i += 2;
        }
        continue;
      }
      const j = findSingleStar(s, i + 1);
      if (j > i + 1) {
        flush(i);
        out += `<em>${inline(s.slice(i + 1, j), env)}</em>`;
        i = j + 1;
        plain = i;
      } else {
        i++;
      }
      continue;
    }
    if (c === '[') {
      const k = findUnescaped(s, ']', i + 1);
      const m = k !== -1 && s[k + 1] === '(' ? s.indexOf(')', k + 2) : -1;
      const target = m === -1 ? '' : s.slice(k + 2, m);
      if (target !== '' && !/\s/.test(target)) {
        flush(i);
        out += `<a href="${escapeHtml(env.link(target))}">${inline(s.slice(i + 1, k), env)}</a>`;
        i = m + 1;
        plain = i;
        continue;
      }
      i++;
      continue;
    }
    i++;
  }
  flush(n);
  return out;
}

/**
 * `src` rendered in one pass over its lines: each block is recognised and
 * rendered where it stands, with no token objects and no per-block line copies.
 * Returns its HTML (each block on its own lines, a "\n" after the last), its
 * table of contents (every level 2 and 3 heading: level, id and inline HTML)
 * and its excerpt (the first paragraph's inline HTML, or "").
 */
export function renderMarkdown(src, env) {
  const lines = src.split('\n');
  const n = lines.length;
  const ids = new Set();
  const toc = [];
  let excerpt = null;
  let html = '';
  let i = 0;
  while (i < n) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    const lang = fenceLang(line);
    if (lang !== null) {
      let j = i + 1;
      while (j < n && !fenceClose(lines[j])) j++;
      const cls = lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`;
      const body = j > i + 1 ? `${escapeHtml(lines.slice(i + 1, j).join('\n'))}\n` : '';
      html += `<pre><code${cls}>${body}</code></pre>\n`;
      i = j + 1;
      continue;
    }
    const hd = headingOf(line);
    if (hd !== null) {
      const id = uniqueSlug(slugify(hd.text), ids);
      const h = inline(hd.text, env);
      html += `<h${hd.depth} id="${id}">${h}</h${hd.depth}>\n`;
      if (hd.depth === 2 || hd.depth === 3) toc.push({ level: hd.depth, id, html: h });
      i++;
      continue;
    }
    if (isHr(line)) {
      html += '<hr>\n';
      i++;
      continue;
    }
    if (line[0] === '>') {
      const parts = [];
      let j = i;
      while (j < n && lines[j][0] === '>') {
        parts.push(trimLine(lines[j].replace(/^> ?/, '')));
        j++;
      }
      const kept = parts.filter((l) => l !== '');
      html += kept.length === 0 ? '<blockquote>\n</blockquote>\n' : `<blockquote>\n<p>${inline(kept.join('\n'), env)}</p>\n</blockquote>\n`;
      i = j;
      continue;
    }
    let m = null;
    let ordered = false;
    let start = 1;
    if (line[0] === '-' || line[0] === '*') m = BULLET.exec(line);
    if (m === null) {
      const om = ORDERED.exec(line);
      if (om !== null) {
        m = om;
        ordered = true;
        start = Number(om[1]);
      }
    }
    if (m !== null) {
      const marker = ordered ? ORDERED : BULLET;
      const items = [trimLine(ordered ? m[2] : m[1])];
      i++;
      while (i < n) {
        const mm = marker.exec(lines[i]);
        if (mm !== null) {
          items.push(trimLine(ordered ? mm[2] : mm[1]));
          i++;
        } else if (CONTINUED.test(lines[i])) {
          items[items.length - 1] += `\n${trimLine(lines[i])}`;
          i++;
        } else break;
      }
      const tag = ordered ? 'ol' : 'ul';
      html += (ordered && start !== 1 ? `<ol start="${start}">` : `<${tag}>`) + '\n';
      for (const item of items) html += `<li>${inline(item, env)}</li>\n`;
      html += `</${tag}>\n`;
      continue;
    }
    let text = trimLine(line);
    i++;
    while (i < n && !endsParagraph(lines[i])) {
      text += `\n${trimLine(lines[i])}`;
      i++;
    }
    const h = inline(text, env);
    if (excerpt === null) excerpt = h;
    html += `<p>${h}</p>\n`;
  }
  return { html, toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- Templates

/** The deepest an include nests: one past it renders nothing. */
export const INCLUDE_DEPTH = 8;

const T_PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const T_FOR = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const T_IF = /^if (not )?(\S+)$/;
const T_INCLUDE = /^include "([a-z0-9-]+)"$/;

/** A template that does not parse: its name and why. */
export class TemplateError extends Error {}

/** The path `text` names, split at its dots, or a TemplateError. */
function pathParts(name, text) {
  if (!T_PATH.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

/**
 * `src` parsed into a tree of nodes (a TemplateError when it does not parse).
 * Tokenising and tree-building run in one pass, with no intermediate token list.
 * Node kinds: text {t}, var/raw {p}, if {not, p, then, els}, for {v, p, body},
 * inc {n}. A {% %} tag alone on its line takes the whole line with it.
 */
export function parseTemplate(name, src) {
  const root = { k: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  let text = '';
  let i = 0;
  const flush = () => {
    if (text !== '') {
      body.push({ k: 'text', t: text });
      text = '';
    }
  };
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      flush();
      body.push({ k: raw ? 'raw' : 'var', p: pathParts(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    flush();
    const tag = src.slice(open + 2, close).trim();
    const top = stack[stack.length - 1];
    let m;
    if ((m = T_FOR.exec(tag)) !== null) {
      const node = { k: 'for', v: m[1], p: pathParts(name, m[2]), body: [] };
      body.push(node);
      stack.push(node);
      body = node.body;
    } else if ((m = T_IF.exec(tag)) !== null) {
      const node = { k: 'if', not: m[1] !== undefined, p: pathParts(name, m[2]), then: [], els: null };
      body.push(node);
      stack.push(node);
      body = node.then;
    } else if (tag === 'else') {
      if (top.k !== 'if' || top.els !== null) throw new TemplateError(`template "${name}": an else outside an if`);
      top.els = [];
      body = top.els;
    } else if (tag === 'endfor' || tag === 'endif') {
      const want = tag === 'endfor' ? 'for' : 'if';
      if (top.k !== want) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
      stack.pop();
      const parent = stack[stack.length - 1];
      body = parent.k === 'root' ? parent.body : parent.k === 'for' ? parent.body : (parent.els ?? parent.then);
    } else if ((m = T_INCLUDE.exec(tag)) !== null) {
      body.push({ k: 'inc', n: m[1] });
    } else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  flush();
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].k} is not closed`);
  return root.body;
}

/**
 * The value at `path` in the scope frames: its first name from the nearest
 * frame holding it, then own properties. `F` holds the frames, innermost last.
 */
function lk(F, p) {
  for (let i = F.length - 1; i >= 0; i--) {
    const o = F[i];
    if (Object.hasOwn(o, p[0])) {
      let v = o[p[0]];
      for (let k = 1; k < p.length; k++) {
        if (v === null || typeof v !== 'object' || !Object.hasOwn(v, p[k])) return undefined;
        v = v[p[k]];
      }
      return v;
    }
  }
  return undefined;
}

/** A value as text: string itself, a number in its own digits, true/false, an array's items joined by ", ", else "". */
function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

/** Whether a value counts as true in an if: not undefined, null, false, "", 0 or an empty array. */
function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

/**
 * A template's nodes compiled once to a plain function (F, M, d, E, T0, R, L):
 * F the scope frames, M the compiled templates by name, d the include depth,
 * E the HTML escape, T0 textOf, R truthy, L the lookup. Loops become real for
 * loops over a pushed frame, includes become direct calls one depth deeper, so
 * rendering walks no tree and allocates no scope object per node.
 */
function compileTemplate(nodes) {
  let tmp = 0;
  const gen = (ns) => {
    let s = '';
    for (const n of ns) {
      if (n.k === 'text') s += `o+=${JSON.stringify(n.t)};`;
      else if (n.k === 'var') s += `o+=E(T0(L(F,${JSON.stringify(n.p)})));`;
      else if (n.k === 'raw') s += `o+=T0(L(F,${JSON.stringify(n.p)}));`;
      else if (n.k === 'if') {
        const cond = `R(L(F,${JSON.stringify(n.p)}))!==${n.not}`;
        s += `if(${cond}){${gen(n.then)}}`;
        if (n.els !== null) s += `else{${gen(n.els)}}`;
      } else if (n.k === 'for') {
        const a = `_a${tmp}`;
        const k = `_k${tmp}`;
        tmp++;
        s += `{const ${a}=L(F,${JSON.stringify(n.p)});if(Array.isArray(${a})){for(let ${k}=0;${k}<${a}.length;${k}++){F.push({${n.v}:${a}[${k}],loop:{index:${k}+1,first:${k}===0,last:${k}===${a}.length-1,length:${a}.length}});${gen(n.body)}F.pop();}}}`;
      } else if (n.k === 'inc') {
        const t = `_t${tmp}`;
        tmp++;
        s += `if(d<${INCLUDE_DEPTH}){const ${t}=M.get(${JSON.stringify(n.n)});if(${t}!==undefined)o+=${t}(F,M,d+1,E,T0,R,L);}`;
      }
    }
    return s;
  };
  return new Function('F', 'M', 'd', 'E', 'T0', 'R', 'L', `let o="";${gen(nodes)}return o;`);
}

// ---------------------------------------------------------------- the build

/** Code-unit order (never the locale's). */
const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** A path's directory, "" at the root. */
const dirOf = (path) => {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
};

/** `rel` (a link's path, "/"-separated) from the directory `dir`, or null when it climbs out of the root. */
function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

/** A link's scheme, for targets kept as written. */
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** The top-level directories the generator writes itself. */
const RESERVED = ['posts', 'tags', 'page'];

/** The report file every build writes. */
export const REPORT_FILE = 'build-report.txt';

/** A page's link record as templates read it. */
const linkOf = (s) => (s === null ? null : {
  title: s.data.title,
  url: s.url,
  date: s.data.date ?? '',
  date_long: s.data.date === undefined ? '' : longDate(s.data.date),
});

/** A post's card, as lists show it; computed once per source and kept on it. */
function cardOf(s) {
  if (s.card !== undefined) return s.card;
  const c = {
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  };
  s.card = c;
  return c;
}

/** A page as its layout reads it. */
function pageOf(s) {
  return {
    ...cardOf(s),
    slug: s.slug,
    content: s.html,
    toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
    newer: linkOf(s.newer ?? null),
    older: linkOf(s.older ?? null),
    is_post: s.post,
  };
}

/** One site's output tree: path -> text. */
export function build(input) {
  // Templates, parsed and compiled in code-unit order of their names; one that
  // does not parse is reported and left out, as if it were not there.
  const templates = new Map();
  const report = [];
  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    try {
      templates.set(name, compileTemplate(parseTemplate(name, input.templates[name])));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  const base = input.site.base_url.replace(/\/+$/, '');

  // Sources in code-unit order of their paths; .md is a source, the rest static.
  const files = [...input.files].sort((a, b) => byCodeUnits(a.path, b.path));
  const sources = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) sources.push({ path: f.path, text: f.content.replace(/\r\n?/g, '\n') });
    else statics.push(f);
  }

  // Front matter, in order: parse error, the generator's own directory, a post
  // with no date, a layout that is no template that parses, then a draft.
  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    const own = !s.post && s.path.startsWith('tags/') ? 'tags' : !s.post && s.path.startsWith('page/') ? 'page' : undefined;
    if (own !== undefined) {
      report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }

  // Permalinks: each slug unique in its directory, in source order.
  const taken = new Map();
  const bySource = new Map();
  for (const s of kept) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === '' ? RESERVED : []);
      taken.set(dir, set);
    }
    s.slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), set);
    s.outDir = dir === '' ? s.slug : `${dir}/${s.slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  // Markdown, each source's links resolved to the pages and static files they
  // name. Resolutions are cached per directory and target: targets repeat a lot.
  const staticPaths = new Set(statics.map((f) => f.path));
  const broken = new Set();
  const linkCache = new Map();
  for (const s of kept) {
    const dir = dirOf(s.path);
    const link = (target) => {
      if (SCHEME.test(target) || target[0] === '/' || target[0] === '#') return target;
      const key = `${dir}\0${target}`;
      let href = linkCache.get(key);
      if (href === undefined) {
        const hash = target.indexOf('#');
        const rel = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? '' : target.slice(hash);
        const path = rel === '' ? null : resolvePath(dir, rel);
        if (path !== null && bySource.has(path)) href = bySource.get(path).url + frag;
        else if (path !== null && staticPaths.has(path)) href = `${base}/${path}${frag}`;
        else href = null;
        linkCache.set(key, href);
      }
      if (href === null) {
        broken.add(`broken-link ${s.path} -> ${target}`);
        return target;
      }
      return href;
    };
    const md = renderMarkdown(s.body, { link });
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  // Collections: the posts, newest date first, equal dates by slug.
  const posts = kept.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });

  // Tags: grouped by slug, each named as first met in the posts' order, ordered
  // by count of posts then slug. A page's tags link to the posts' tag of the
  // same slug, or to nothing where no post has it.
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    for (const name of (s.data.tags ?? [])) {
      const slug = slugify(name);
      if (seen.has(slug)) continue;
      seen.add(slug);
      out.push(name);
    }
    return out;
  };
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${base}/tags/${slug}/`, posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of kept) {
    if (s.post) continue;
    s.tagRefs = ownTags(s).map((name) => {
      const slug = slugify(name);
      return bySlug.get(slug) ?? { name, slug, url: '', posts: [] };
    });
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  // Layouts: every page through its layout, the index pages, the tag pages and
  // the tags page through theirs, then the static files at their own paths.
  const output = {};
  const cards = new Map(posts.map((p) => [p, cardOf(p)]));
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => cards.get(p));
  const render = (name, vars) => {
    const fn = templates.get(name);
    if (fn === undefined) return null;
    return fn([{ site, tags: allTags, recent, ...vars }], templates, 0, escapeHtml, textOf, truthy, lk);
  };
  for (const s of kept) output[`${s.outDir}/index.html`] = render(s.layout, { page: pageOf(s) });
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of tags) {
    const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) } });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  // The report: every refusal, draft, broken link and template that did not
  // parse, sorted, then the counts.
  const lines = [...report, ...broken].sort(byCodeUnits);
  const pageCount = kept.filter((s) => !s.post).length;
  lines.push(`built ${pageCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output[REPORT_FILE] = `${lines.join('\n')}\n`;
  return output;
}

/** makefun-site 1.0.0's answer for one case's input. */
export function run(input) {
  return build(input);
}
