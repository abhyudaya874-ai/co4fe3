import type { ReactNode } from "react";

// A small syntax highlighter for the code blocks in the chat. It colours comments, strings, numbers, keywords and
// calls well enough to read a snippet; it is not a parser. The output is React elements, never HTML.

const KEYWORDS: Record<string, string> = {
  py: "False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self cls match case",
  js: "async await break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return static super switch this throw try typeof var void while with yield interface type enum implements public private protected readonly abstract declare namespace as from null undefined true false",
  go: "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false",
  rust: "as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while true false",
  c: "auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while class public private protected namespace template using new delete this nullptr true false bool",
  java: "abstract boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static super switch synchronized this throw throws try void volatile while null true false var",
  sh: "if then else elif fi for while do done case esac function in return export local readonly set unset echo cd source exit",
  sql: "select from where insert into values update set delete create table drop alter join left right inner outer on group by order having limit and or not null as distinct union",
  yaml: "true false null yes no",
  json: "true false null",
};
const FAMILY: Record<string, string> = {
  python: "py", py: "py", python3: "py",
  javascript: "js", js: "js", jsx: "js", typescript: "js", ts: "js", tsx: "js", mjs: "js", cjs: "js",
  go: "go", golang: "go", rust: "rust", rs: "rust",
  c: "c", h: "c", cpp: "c", "c++": "c", cc: "c", hpp: "c", cs: "c", csharp: "c", swift: "c", kotlin: "java", java: "java", scala: "java",
  bash: "sh", sh: "sh", shell: "sh", zsh: "sh", console: "sh",
  sql: "sql", yaml: "yaml", yml: "yaml", toml: "yaml", ini: "yaml", json: "json", jsonc: "json",
};
const HASH_COMMENT = new Set(["py", "sh", "yaml"]);
const SLASH_COMMENT = new Set(["js", "go", "rust", "c", "java", "json"]);
const MAX_CHARS = 8000;

type Kind = "kw" | "str" | "com" | "num" | "fn";
const sets = new Map<string, Set<string>>();
const wordsOf = (fam: string): Set<string> => {
  let s = sets.get(fam);
  if (!s) { s = new Set((KEYWORDS[fam] ?? "").split(" ")); sets.set(fam, s); }
  return s;
};

/** The language family for a fence's info string ("python", "ts", "diff", …), or null when unknown. */
export const familyOf = (lang: string): string | null => FAMILY[lang.toLowerCase()] ?? null;

/** Splits `code` into plain text and classed spans. Unknown languages and very long blocks come back plain. */
export function highlight(code: string, lang: string): ReactNode {
  const l = lang.toLowerCase();
  if (l === "diff" || l === "patch") return diffLines(code);
  const fam = familyOf(l);
  if (!fam || code.length > MAX_CHARS) return code;
  const kw = wordsOf(fam);
  const out: ReactNode[] = [];
  let plain = "", key = 0;
  const flush = () => { if (plain) { out.push(plain); plain = ""; } };
  const span = (kind: Kind, text: string) => { flush(); out.push(<span key={key++} className={`tok-${kind}`}>{text}</span>); };
  for (let i = 0; i < code.length; ) {
    const c = code[i]!, rest = code.slice(i);
    // comments
    if ((HASH_COMMENT.has(fam) && c === "#") || (fam === "sql" && rest.startsWith("--")) || (SLASH_COMMENT.has(fam) && rest.startsWith("//"))) {
      const end = code.indexOf("\n", i); const stop = end < 0 ? code.length : end;
      span("com", code.slice(i, stop)); i = stop; continue;
    }
    if (rest.startsWith("/*") && (SLASH_COMMENT.has(fam) || fam === "sql")) {
      const end = code.indexOf("*/", i + 2); const stop = end < 0 ? code.length : end + 2;
      span("com", code.slice(i, stop)); i = stop; continue;
    }
    // strings: triple-quoted (python), then ' " and, for js/go, `
    if (fam === "py" && (rest.startsWith('"""') || rest.startsWith("'''"))) {
      const q = rest.slice(0, 3); const end = code.indexOf(q, i + 3); const stop = end < 0 ? code.length : end + 3;
      span("str", code.slice(i, stop)); i = stop; continue;
    }
    if (c === '"' || c === "'" || ((fam === "js" || fam === "go") && c === "`")) {
      let j = i + 1;
      while (j < code.length && code[j] !== c && (c === "`" || code[j] !== "\n")) j += code[j] === "\\" ? 2 : 1;
      const stop = Math.min(code.length, j + 1);
      if (c === "'" && fam !== "py" && fam !== "js" && fam !== "sh" && fam !== "yaml" && fam !== "sql" && !code.slice(i, stop).endsWith("'")) { plain += c; i++; continue; }   // a lifetime or a stray quote, not a string
      span("str", code.slice(i, stop)); i = stop; continue;
    }
    // numbers
    const num = /^(0x[0-9a-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(rest);
    if (num && !/[\w$]/.test(code[i - 1] ?? " ")) { span("num", num[0]); i += num[0].length; continue; }
    // words: keywords, and names followed by "("
    const word = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (word) {
      const w = word[0];
      if (kw.has(w) && !/[\w$.]/.test(code[i - 1] ?? " ")) span("kw", w);
      else if (code[i + w.length] === "(" && fam !== "json") span("fn", w);
      else plain += w;
      i += w.length; continue;
    }
    plain += c; i++;
  }
  flush();
  return out;
}

/** A diff: added lines green, removed lines red, hunk headers dim. */
function diffLines(code: string): ReactNode {
  return code.split("\n").map((line, i, all) => {
    const kind = line.startsWith("+++") || line.startsWith("---") ? "meta" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : line.startsWith("@@") ? "hunk" : "ctx";
    return <span key={i} className={`tok-${kind}`}>{line}{i < all.length - 1 ? "\n" : ""}</span>;
  });
}
