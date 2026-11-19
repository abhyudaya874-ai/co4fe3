import { createElement as h, Fragment } from "react";

/** A tiny safe markdown renderer: paragraphs, `code`, fenced blocks and lists. React elements only — model text is data. */
export function md(text: string) {
  const lines = text.split("\n");
  const out: ReturnType<typeof h>[] = [];
  let fence: string[] | null = null;
  let list: string[] | null = null;
  let para: string[] = [];
  const flushPara = (key: string) => {
    if (para.length) { out.push(h("p", { key, className: "md-p" }, inline(para.join(" ")))); para = []; }
  };
  const flushList = (key: string) => {
    if (list) { out.push(h("ul", { key }, list.map((li, i) => h("li", { key: i }, inline(li))))); list = null; }
  };
  lines.forEach((raw, i) => {
    const fenceOpen = /^\s*```/.exec(raw);
    if (fenceOpen && fence === null) { flushPara(`p${i}`); flushList(`l${i}`); fence = []; return; }
    if (fence !== null && fenceOpen) { out.push(h("pre", { key: `f${i}`, className: "md-pre" }, fence.join("\n"))); fence = null; return; }
    if (fence !== null) { fence.push(raw); return; }
    const li = /^\s*[-*]\s+(.*)$/.exec(raw);
    if (li) { flushPara(`p${i}`); list ??= []; list.push(li[1]!); return; }
    flushList(`l${i}`);
    if (raw.trim() === "") flushPara(`p${i}`);
    else para.push(raw);
  });
  if (fence !== null) out.push(h("pre", { key: "f-end", className: "md-pre" }, (fence as string[]).join("\n")));
  flushPara("p-end"); flushList("l-end");
  return h(Fragment, null, out);
}

/** Inline: `code`, **bold**. No HTML anywhere. */
function inline(s: string) {
  const parts: (string | ReturnType<typeof h>)[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let at = 0, m: RegExpExecArray | null, key = 0;
  while ((m = re.exec(s))) {
    if (m.index > at) parts.push(s.slice(at, m.index));
    if (m[1] !== undefined) parts.push(h("code", { key: key++, className: "md-code" }, m[1]));
    else parts.push(h("strong", { key: key++ }, m[2]!));
    at = m.index + m[0].length;
  }
  if (at < s.length) parts.push(s.slice(at));
  return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : h(Fragment, null, parts);
}
