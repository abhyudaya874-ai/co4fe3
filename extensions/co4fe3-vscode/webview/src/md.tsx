import { Fragment, useMemo, useState, type ReactNode } from "react";
import { fileLink, fileRef } from "./format.js";
import { highlight } from "./highlight.js";

export interface MdOptions {
  /** A click on `path` or `path:line` written in code, or on a link to a workspace file. The host jails the path. */
  onFile?: (path: string, line?: number) => void;
}

/**
 * Markdown for model text. Headings, paragraphs with hard breaks, **bold**, *italic*, ~~strike~~, `code`, links,
 * fenced code with highlighting, bullet / numbered / task lists (nested), block quotes, rules and GFM tables.
 * Output is React elements only: model text is data, and HTML in it is shown as text.
 */
export function md(text: string, o: MdOptions = {}): ReactNode {
  return <Fragment>{blocks(text.replace(/\r\n?/g, "\n").split("\n"), o, "m", false)}</Fragment>;
}

// ── block level ─────────────────────────────────────────────────────────────

const FENCE = /^(\s{0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/;
const HEADING = /^\s{0,3}(#{1,6})[ \t]+(\S.*?)(?:[ \t]+#+)?[ \t]*$/;
const HR = /^\s{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const BULLET = /^(\s*)([-*+•])[ \t]+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})([.)])[ \t]+(.*)$/;
const QUOTE = /^\s{0,3}>[ \t]?(.*)$/;
const DELIM_CELL = /^\s*:?-+:?\s*$/;

type Align = "left" | "center" | "right" | undefined;
interface Marker { indent: number; ordered: boolean; num: number; width: number; text: string }

const indentOf = (l: string): number => l.length - l.trimStart().length;
const isBlank = (l: string): boolean => l.trim() === "";

function markerOf(l: string): Marker | null {
  if (HR.test(l)) return null;
  const b = BULLET.exec(l);
  if (b) return { indent: b[1]!.length, ordered: false, num: 0, width: 2, text: b[3]! };
  const n = ORDERED.exec(l);
  return n ? { indent: n[1]!.length, ordered: true, num: Number(n[2]), width: n[2]!.length + 2, text: n[4]! } : null;
}

/** Splits a table row on `|`, ignoring pipes inside `code` and `\|`. Leading and trailing pipes are optional. */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; ) {
    const c = s[i]!;
    if (c === "\\" && s[i + 1] === "|") { cur += "|"; i += 2; continue; }
    if (c === "`") {
      let n = 1; while (s[i + n] === "`") n++;
      const close = s.indexOf("`".repeat(n), i + n);
      if (close > 0) { cur += s.slice(i, close + n); i = close + n; continue; }
      cur += s.slice(i, i + n); i += n; continue;
    }
    if (c === "|") { cells.push(cur.trim()); cur = ""; i++; continue; }
    cur += c; i++;
  }
  cells.push(cur.trim());
  return cells;
}

/** Does a table start at `lines[i]`? A header row with a pipe, then a delimiter row with the same number of cells. */
function tableAt(lines: string[], i: number): { header: string[]; align: Align[] } | null {
  const head = lines[i], delim = lines[i + 1];
  if (head === undefined || delim === undefined || !head.includes("|") || !delim.includes("|") || !delim.includes("-")) return null;
  const dCells = splitRow(delim);
  if (!dCells.every((c) => DELIM_CELL.test(c))) return null;
  const header = splitRow(head);
  if (header.length !== dCells.length) return null;
  const align = dCells.map((c): Align => { const t = c.trim(); return t.startsWith(":") && t.endsWith(":") ? "center" : t.endsWith(":") ? "right" : t.startsWith(":") ? "left" : undefined; });
  return { header, align };
}

/** Does this line begin a block that ends the paragraph above it? */
function startsBlock(lines: string[], i: number): boolean {
  const l = lines[i]!;
  if (FENCE.test(l) || HEADING.test(l) || HR.test(l) || QUOTE.test(l) || tableAt(lines, i)) return true;
  const m = markerOf(l);
  return !!m && (!m.ordered || m.num === 1);                                   // an ordered list interrupts a paragraph only when it starts at 1
}

function blocks(lines: string[], o: MdOptions, key: string, tight: boolean): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0, k = 0;
  const id = (): string => `${key}.${k++}`;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlank(line)) { i++; continue; }

    const fence = FENCE.exec(line);
    if (fence) {                                                               // fenced code; an unclosed fence runs to the end (text still streaming)
      const mark = fence[2]!, body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s{0,3}${mark[0] === "`" ? "`" : "~"}{${mark.length},}\\s*$`).test(lines[i]!)) { body.push(lines[i]!.slice(Math.min(indentOf(lines[i]!), fence[1]!.length))); i++; }
      i++;
      out.push(<CodeBlock key={id()} lang={fence[3] ?? ""} code={body.join("\n")} />);
      continue;
    }

    const h = HEADING.exec(line);
    if (h) {
      const Tag = `h${Math.min(6, h[1]!.length + 1)}` as "h2" | "h3" | "h4" | "h5" | "h6";   // the chat's own title is the page, so # becomes h2
      out.push(<Tag key={id()} className="md-h">{inline(h[2]!, o)}</Tag>);
      i++; continue;
    }
    if (HR.test(line)) { out.push(<hr key={id()} className="md-hr" />); i++; continue; }

    const table = tableAt(lines, i);
    if (table) {
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && !isBlank(lines[i]!) && lines[i]!.includes("|") && !FENCE.test(lines[i]!)) { rows.push(splitRow(lines[i]!)); i++; }
      out.push(<Table key={id()} header={table.header} align={table.align} rows={rows} o={o} />);
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && !isBlank(lines[i]!)) {
        const q = QUOTE.exec(lines[i]!);
        if (q) inner.push(q[1]!);
        else if (startsBlock(lines, i)) break;
        else inner.push(lines[i]!);                                            // a lazy continuation line
        i++;
      }
      out.push(<blockquote key={id()} className="md-quote">{blocks(inner, o, id(), false)}</blockquote>);
      continue;
    }

    const marker = markerOf(line);
    if (marker) { const r = list(lines, i, o, id()); out.push(r.node); i = r.next; continue; }

    // a paragraph runs until a blank line or the start of another block
    const para: string[] = [line];
    i++;
    while (i < lines.length && !isBlank(lines[i]!) && !startsBlock(lines, i)) { para.push(lines[i]!); i++; }
    out.push(<p key={id()} className={`md-p${tight ? " tight" : ""}`}>{inline(para.join("\n"), o)}</p>);
  }
  return out;
}

function list(lines: string[], start: number, o: MdOptions, key: string): { node: ReactNode; next: number } {
  const first = markerOf(lines[start]!)!;
  const items: { lines: string[]; checked: boolean | null }[] = [];
  let i = start;
  while (i < lines.length) {
    const m = markerOf(lines[i]!);
    if (!m || m.indent > first.indent + 1 || m.indent < first.indent - 1 || m.ordered !== first.ordered) break;   // not a sibling of this list
    const content = m.indent + m.width;
    const body: string[] = [m.text];
    i++;
    while (i < lines.length) {
      const l = lines[i]!;
      if (isBlank(l)) {                                                        // a blank line stays in the item only when indented content follows
        let j = i; while (j < lines.length && isBlank(lines[j]!)) j++;
        const nx = lines[j];
        if (nx === undefined) break;
        const nm = markerOf(nx);
        if (indentOf(nx) >= content || (nm && nm.indent > m.indent)) { for (; i < j; i++) body.push(""); continue; }
        break;
      }
      const nm = markerOf(l);
      if (nm && nm.indent <= m.indent) break;                                  // the next item, or the end of this list
      if (nm || indentOf(l) >= content) { body.push(l.slice(Math.min(indentOf(l), content))); i++; continue; }
      if (startsBlock(lines, i)) break;
      body.push(l.trim()); i++;                                                // a lazy continuation of the item's paragraph
    }
    const task = /^\[([ xX])\][ \t]+/.exec(body[0]!);
    if (task) body[0] = body[0]!.slice(task[0].length);
    items.push({ lines: body, checked: task ? task[1] !== " " : null });
  }
  const children = items.map((it, n) => (
    <li key={n} className={it.checked === null ? undefined : "md-task"}>
      {it.checked !== null && <span className={`md-box${it.checked ? " on" : ""}`} aria-label={it.checked ? "done" : "not done"} role="img" />}
      {blocks(it.lines, o, `${key}.${n}`, true)}
    </li>
  ));
  const node = first.ordered
    ? <ol key={key} className="md-ol" start={first.num !== 1 ? first.num : undefined}>{children}</ol>
    : <ul key={key} className="md-ul">{children}</ul>;
  return { node, next: i };
}

function Table({ header, align, rows, o }: { header: string[]; align: Align[]; rows: string[][]; o: MdOptions }) {
  const cell = (c: string | undefined, j: number) => ({ children: inline(c ?? "", o), style: align[j] ? { textAlign: align[j] } : undefined });
  return (
    <div className="md-table-wrap">
      <table className="md-table">
        <thead><tr>{header.map((c, j) => <th key={j} {...cell(c, j)} />)}</tr></thead>
        <tbody>{rows.map((r, n) => <tr key={n}>{header.map((_, j) => <td key={j} {...cell(r[j], j)} />)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const body = useMemo(() => highlight(code, lang), [code, lang]);
  const copy = () => {
    void Promise.resolve(navigator.clipboard?.writeText(code)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }, () => undefined);
  };
  return (
    <div className="md-code-block">
      <div className="md-code-head">
        <span className="md-code-lang">{lang}</span>
        <button type="button" className="md-copy" onClick={copy} aria-label="Copy the code">{copied ? "Copied" : "Copy"}</button>
      </div>
      <pre className="md-pre"><code>{body}</code></pre>
    </div>
  );
}

// ── inline level ────────────────────────────────────────────────────────────

const ESCAPABLE = "\\`*_{}[]()#+-.!|~<>$&\"'";
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", "#39": "'" };
const TAGS: Record<string, "strong" | "em" | "code" | "sup" | "sub" | "del"> = { b: "strong", strong: "strong", i: "em", em: "em", code: "code", kbd: "code", sup: "sup", sub: "sub", del: "del", s: "del" };
const isWord = (c: string | undefined): boolean => !!c && /[\p{L}\p{N}]/u.test(c);
const isSpace = (c: string | undefined): boolean => c === undefined || /\s/.test(c);

const CODE_WINDOW = 4000;

/** A `code span` starting at `i`: its text and where it ends. Emphasis and link scans meet the same backtick run again and
 *  again, so each answer (including "no closing run") is remembered per string and position. */
type Span = { text: string; end: number } | null;
const spanMemo = new WeakMap<object, Map<number, Span>>();
const memoKey = new Map<string, object>();
function codeSpan(s: string, i: number): Span {
  let key = memoKey.get(s);
  if (!key) { if (memoKey.size > 64) memoKey.clear(); key = {}; memoKey.set(s, key); }
  let m = spanMemo.get(key);
  if (!m) { m = new Map(); spanMemo.set(key, m); }
  if (m.has(i)) return m.get(i)!;
  const r = findCodeSpan(s, i);
  m.set(i, r);
  return r;
}
function findCodeSpan(s: string, i: number): Span {
  let n = 0; while (s[i + n] === "`") n++;
  let from = i + n;
  const stop = Math.min(s.length, i + n + CODE_WINDOW);
  for (;;) {
    const at = s.indexOf("`".repeat(n), from);
    if (at < 0 || at > stop) return null;
    let r = 0; while (s[at + r] === "`") r++;
    if (r === n) {
      let text = s.slice(i + n, at).replace(/\n/g, " ");
      if (text.length > 2 && text.startsWith(" ") && text.endsWith(" ")) text = text.slice(1, -1);
      return { text, end: at + n };
    }
    from = at + r;                                                              // a longer run is not our closer
  }
}

/** `[text](url "title")` at `i`. */
function linkAt(s: string, i: number): { text: string; url: string; end: number } | null {
  let depth = 0, j = i;
  for (; j < s.length; j++) {
    const c = s[j]!;
    if (c === "\\") { j++; continue; }
    if (c === "`") { const cs = codeSpan(s, j); if (cs) { j = cs.end - 1; continue; } }
    if (c === "[") depth++;
    else if (c === "]" && --depth === 0) break;
  }
  if (j >= s.length || s[j + 1] !== "(") return null;
  const text = s.slice(i + 1, j);
  let p = j + 2, url = "";
  while (s[p] === " ") p++;
  if (s[p] === "<") { const e = s.indexOf(">", p); if (e < 0) return null; url = s.slice(p + 1, e); p = e + 1; }
  else { let d = 0; for (; p < s.length; p++) { const c = s[p]!; if (c === "(") d++; else if (c === ")") { if (d === 0) break; d--; } else if (/\s/.test(c)) break; url += c; } }
  while (s[p] === " ") p++;
  if (s[p] === '"' || s[p] === "'") { const e = s.indexOf(s[p]!, p + 1); if (e < 0) return null; p = e + 1; while (s[p] === " ") p++; }   // the title is dropped
  return s[p] === ")" ? { text, url, end: p + 1 } : null;
}

/** An emphasis run at `i`: the inner text, which element, and where it ends. */
const EMPHASIS_WINDOW = 4000;                                                    // an emphasised span longer than this is not worth finding

function emphasisAt(s: string, i: number): { inner: string; el: "strong" | "em" | "del" | "strongem"; end: number; used: number } | null {
  const ch = s[i]!;
  let n = 0; while (s[i + n] === ch) n++;
  if (isSpace(s[i + n])) return null;                                          // an opener is followed by text
  if (ch === "_" && isWord(s[i - 1])) return null;                             // snake_case is not emphasis
  const tries = ch === "~" ? (n >= 2 ? [2] : []) : n >= 3 ? [3, 2, 1] : n === 2 ? [2, 1] : [1];
  for (const k of tries) {
    const limit = Math.min(s.length, i + n + EMPHASIS_WINDOW);
    for (let j = i + n; j < limit; j++) {
      const c = s[j]!;
      if (c === "\\") { j++; continue; }
      if (c === "`") { const cs = codeSpan(s, j); if (cs) { j = cs.end - 1; continue; } }
      if (c !== ch) continue;
      let r = 0; while (s[j + r] === ch) r++;
      if (r >= k && !isSpace(s[j - 1]) && !(ch === "_" && isWord(s[j + r]))) {
        const closeAt = j + r - k;                                              // the last k marks of the run close it, so `**a *b***` nests
        const inner = s.slice(i + n, closeAt);
        if (inner.trim()) return { inner, el: ch === "~" ? "del" : k === 3 ? "strongem" : k === 2 ? "strong" : "em", end: closeAt + k, used: n - Math.min(n, k) };
      }
      j += r - 1;
    }
  }
  return null;
}

function inline(src: string, o: MdOptions): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = "", k = 0;
  const flush = () => { if (buf) { out.push(buf); buf = ""; } };
  const push = (n: ReactNode) => { flush(); out.push(<Fragment key={k++}>{n}</Fragment>); };

  for (let i = 0; i < src.length; ) {
    const c = src[i]!;
    if (c === "\\") {
      const n = src[i + 1];
      if (n === "\n") { push(<br />); i += 2; continue; }
      if (n !== undefined && ESCAPABLE.includes(n)) { buf += n; i += 2; continue; }
      buf += c; i++; continue;
    }
    if (c === "\n") {
      if (/ {2,}$/.test(buf)) { buf = buf.replace(/ +$/, ""); push(<br />); } else buf = `${buf.replace(/ +$/, "")} `;
      i++; continue;
    }
    if (c === "`") {
      const cs = codeSpan(src, i);
      if (cs) {
        const ref = o.onFile ? fileRef(cs.text) : null;
        push(ref
          ? <button type="button" className="md-code md-file" title={`Open ${ref.path}`} onClick={() => o.onFile?.(ref.path, ref.line)}>{cs.text}</button>
          : <code className="md-code">{cs.text}</code>);
        i = cs.end; continue;
      }
      let n = 0; while (src[i + n] === "`") n++;
      buf += "`".repeat(n); i += n; continue;
    }
    if (c === "!" && src[i + 1] === "[") {                                    // images are not loaded (the page allows none): show the description
      const l = linkAt(src, i + 1);
      if (l) { buf += l.text ? `[${l.text}]` : ""; i = l.end; continue; }
    }
    if (c === "[") {
      const l = linkAt(src, i);
      if (l) {
        const web = /^(https?:\/\/|mailto:)/i.test(l.url);
        const file = !web && o.onFile ? fileLink(l.url) : null;
        if (web) push(<a href={l.url} rel="noreferrer noopener">{inline(l.text, o)}</a>);
        else if (file) push(<button type="button" className="md-link" title={`Open ${file.path}`} onClick={() => o.onFile?.(file.path, file.line)}>{inline(l.text, o)}</button>);
        else push(<>{inline(l.text, o)}</>);                                  // any other scheme (javascript:, data:) is never a link
        i = l.end; continue;
      }
    }
    if (c === "*" || c === "_" || c === "~") {
      const e = emphasisAt(src, i);
      if (e) {
        let n = 0; while (src[i + n] === c) n++;
        buf += c.repeat(e.used);
        const inner = inline(e.inner, o);
        push(e.el === "strong" ? <strong>{inner}</strong> : e.el === "em" ? <em>{inner}</em> : e.el === "del" ? <del>{inner}</del> : <strong><em>{inner}</em></strong>);
        i = e.end; continue;
      }
      let n = 0; while (src[i + n] === c) n++;
      buf += c.repeat(n); i += n; continue;
    }
    if (c === "<") {
      const auto = /^<(https?:\/\/[^\s<>]+)>/i.exec(src.slice(i));
      if (auto) { push(<a href={auto[1]} rel="noreferrer noopener">{auto[1]}</a>); i += auto[0].length; continue; }
      const tag = /^<(\/?)([a-z]+)\s*(\/?)>/i.exec(src.slice(i));
      if (tag && !tag[1]) {
        const name = tag[2]!.toLowerCase();
        if (name === "br") { push(<br />); i += tag[0].length; continue; }
        const el = TAGS[name];
        const close = el ? src.toLowerCase().indexOf(`</${name}>`, i + tag[0].length) : -1;
        if (el && close > 0) {
          const text = src.slice(i + tag[0].length, close);
          push(el === "code" ? <code className="md-code">{text}</code> : el === "strong" ? <strong>{inline(text, o)}</strong> : el === "em" ? <em>{inline(text, o)}</em> : el === "sup" ? <sup>{inline(text, o)}</sup> : el === "sub" ? <sub>{inline(text, o)}</sub> : <del>{inline(text, o)}</del>);
          i = close + name.length + 3; continue;
        }
      }
    }
    if (c === "&") {
      const ent = /^&(amp|lt|gt|quot|apos|nbsp|#39);/.exec(src.slice(i, i + 8));
      if (ent) { buf += ENTITIES[ent[1]!]; i += ent[0].length; continue; }
    }
    if (c === "h" && !isWord(src[i - 1]) && /^https?:\/\//i.test(src.slice(i, i + 8))) {
      const m = /^https?:\/\/[^\s<>"'`]+/i.exec(src.slice(i))!;
      let url = m[0];
      for (;;) {                                                               // trailing punctuation, and a closing paren that has no opener, belong to the sentence
        const last = url[url.length - 1]!;
        if (/[.,;:!?'"\]}]/.test(last) || (last === ")" && (url.match(/\(/g) ?? []).length < (url.match(/\)/g) ?? []).length)) url = url.slice(0, -1); else break;
      }
      push(<a href={url} rel="noreferrer noopener">{url}</a>);
      i += url.length; continue;
    }
    buf += c; i++;
  }
  flush();
  return out;
}
