import { describe, it, expect } from "vitest";
import { renderToString as ssr } from "react-dom/server";
import { md, splitRow } from "../src/md.js";
import { highlight } from "../src/highlight.js";

/** Server rendering separates adjacent text nodes with comments; the text a person reads has none. */
const html = (text: string, onFile?: (p: string, l?: number) => void): string => ssr(<div>{md(text, { onFile })}</div>).replace(/<!-- -->/g, "");
const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length;

// The reply that rendered as one long line of pipes in the Agent view (a table, written one row per line).
const TABLE = [
  "Key modules and what they own:",
  "",
  "| Module | Responsibility |",
  "|--------|----------------|",
  "| `app.py` (1536 lines) | `Flask(App)` — the WSGI application object: routing, dispatch, error handling |",
  "| `sansio/app.py` (964 lines) | `App(Scaffold)` — the IO-free core |",
  "| `helpers.py` | `url_for`, `redirect`, `abort`, `flash`, `send_file` |",
  "",
  "**Architectural note:** it is IO-free.",
].join("\n");

describe("tables", () => {
  it("a pipe table becomes a real table: header cells, body rows, inline code in cells", () => {
    const h = html(TABLE);
    expect(h).toContain("<table"); expect(count(h, /<th[ >]/g)).toBe(2); expect(count(h, /<tr[ >]/g)).toBe(4);
    expect(h).toContain("<code class=\"md-code\">app.py</code> (1536 lines)");
    expect(h).toContain("<code class=\"md-code\">url_for</code>");
    expect(h).not.toContain("|--------|");                       // the delimiter row never shows
    expect(h).not.toMatch(/<p[^>]*>[^<]*\| Module/);             // and the header is not a paragraph of pipes
  });
  it("the text before and after the table stays paragraphs", () => {
    const h = html(TABLE);
    expect(h).toContain("Key modules and what they own:"); expect(h).toContain("<strong>Architectural note:</strong>");
  });
  it("alignment from the delimiter row", () => {
    const h = html("| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |");
    expect(h).toContain('<th style="text-align:left">a</th>'); expect(h).toContain('<th style="text-align:center">b</th>'); expect(h).toContain('<td style="text-align:right">3</td>');
  });
  it("no outer pipes", () => {
    const h = html("a | b\n--- | ---\n1 | 2");
    expect(h).toContain("<table"); expect(count(h, /<td[ >]/g)).toBe(2);
  });
  it("short rows are padded, long rows are cut to the header", () => {
    const h = html("| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |");
    expect(count(h, /<td[ >]/g)).toBe(4); expect(h).not.toContain(">3<");
  });
  it("a pipe inside `code` or escaped as \\| stays in its cell", () => {
    expect(splitRow("| `a|b` | c |")).toEqual(["`a|b`", "c"]);
    expect(splitRow("| a \\| b | c |")).toEqual(["a | b", "c"]);
    expect(count(html("| x | y |\n|---|---|\n| `a|b` | z |"), /<td[ >]/g)).toBe(2);
  });
  it("<br> inside a cell is a line break, not text", () => {
    const h = html("| a | b |\n|---|---|\n| one<br>two | x |");
    expect(h).toContain("one<br/>two"); expect(h).not.toContain("&lt;br");
  });
  it("a table still being streamed (no delimiter row yet) is plain text, then a table once the row arrives", () => {
    expect(html("| a | b |")).not.toContain("<table");
    expect(html("| a | b |\n|---|---|")).toContain("<table");
    expect(html("| a | b |\n|---|---|\n| 1 | 2 | ext")).toContain("<table");
  });
  it("a header and delimiter with different widths is not a table", () => { expect(html("| a | b |\n|---|---|---|\n| 1 | 2 |")).not.toContain("<table"); });
  it("a lone --- line is a rule, not a table", () => { const h = html("text\n\n---\n\nmore"); expect(h).toContain("<hr"); expect(h).not.toContain("<table"); });
  it("the table ends at a blank line; the next paragraph is not a row", () => {
    const h = html("| a | b |\n|---|---|\n| 1 | 2 |\n\nnot a row | with a pipe");
    expect(count(h, /<tr[ >]/g)).toBe(2); expect(h).toContain("not a row | with a pipe");
  });
});

describe("paragraphs and inline", () => {
  it("consecutive lines are one paragraph; two spaces or a backslash make a hard break", () => {
    expect(html("one\ntwo")).toContain("one two");
    expect(html("one  \ntwo")).toContain("one<br/>two");
    expect(html("one\\\ntwo")).toContain("one<br/>two");
  });
  it("bold, italic, bold-italic, strike, and the nesting a model writes", () => {
    const h = html("**b** *i* ***bi*** ~~s~~ **bold with *nested* inside** and **a *b***");
    expect(h).toContain("<strong>b</strong>"); expect(h).toContain("<em>i</em>"); expect(h).toContain("<strong><em>bi</em></strong>"); expect(h).toContain("<del>s</del>");
    expect(h).toContain("<strong>bold with <em>nested</em> inside</strong>"); expect(h).toContain("<strong>a <em>b</em></strong>");
  });
  it("snake_case and arithmetic stars are not emphasis", () => {
    const h = html("use my_var_name and 2 * 3 * 4 and __init__ ok");
    expect(h).toContain("my_var_name"); expect(h).toContain("2 * 3 * 4"); expect(h).not.toContain("<em>");
  });
  it("code spans, including a backtick inside double backticks", () => {
    expect(html("a `x` b")).toContain('<code class="md-code">x</code>');
    expect(html("a ``x ` y`` b")).toContain('<code class="md-code">x ` y</code>');
    expect(html("`*not bold*`")).toContain("*not bold*");
  });
  it("backslash escapes", () => { const h = html("\\*literal\\* and \\`tick"); expect(h).toContain("*literal*"); expect(h).not.toContain("<em>"); });
  it("entities decode to text, never to markup", () => { const h = html("a &amp; b &lt;script&gt;"); expect(h).toContain("a &amp; b &lt;script&gt;"); expect(h).not.toContain("<script"); });
  it("HTML in model text is shown as text", () => {
    const h = html("<img src=x onerror=alert(1)> and <script>alert(1)</script> and <div>x</div>");
    expect(h).not.toContain("<img"); expect(h).not.toContain("<script"); expect(h).not.toContain("<div>x"); expect(h).toContain("&lt;img");
  });
  it("a few paired inline tags that models write: <b>, <i>, <code>, <sup>", () => {
    const h = html("<b>x</b> <i>y</i> <code>z</code> H<sub>2</sub>O");
    expect(h).toContain("<strong>x</strong>"); expect(h).toContain("<em>y</em>"); expect(h).toContain('<code class="md-code">z</code>'); expect(h).toContain("<sub>2</sub>");
  });
});

describe("links", () => {
  it("http(s) and bare URLs are anchors; trailing punctuation stays outside", () => {
    const h = html("[docs](https://example.com/a_(b)) and https://example.com/x, then <https://e.org>.");
    expect(h).toContain('href="https://example.com/a_(b)"'); expect(h).toContain('href="https://example.com/x"'); expect(h).toContain('href="https://e.org"');
    expect(h).toMatch(/x<\/a>, then/);
  });
  it("javascript: and data: never become links", () => {
    const h = html("[a](javascript:alert(1)) [b](data:text/html,x) [c](vbscript:x)");
    expect(h).not.toContain("href="); expect(h).toContain("a b c");
  });
  it("a link to a workspace file opens the file when the host can; with a line from #L12", () => {
    const h = html("see [cli](src/flask/cli.py#L12) and [x](./a.py:3)", () => undefined);
    expect(count(h, /class="md-link"/g)).toBe(2); expect(h).toContain("Open src/flask/cli.py");
    expect(html("see [cli](src/flask/cli.py)")).not.toContain("md-link");
  });
  it("an image is not loaded: its description stays", () => { const h = html("![the diagram](https://e.org/a.png)"); expect(h).not.toContain("<img"); expect(h).toContain("the diagram"); });
  it("a file name in code is an open button only when the host can open it", () => {
    expect(html("see `src/a.py:3`", () => undefined)).toContain("md-file"); expect(html("see `src/a.py:3`")).not.toContain("md-file");
  });
});

describe("blocks", () => {
  it("headings h1-h6 become h2-h6 and keep inline formatting", () => {
    const h = html("# One\n## Two **b**\n###### Six"); expect(h).toContain("<h2"); expect(h).toContain("<h3"); expect(h).toContain("<h6"); expect(h).toContain("<strong>b</strong>");
  });
  it("bullet list, numbered list from 1, and a list that starts at 3", () => {
    expect(html("- a\n- b")).toContain("<ul"); expect(count(html("- a\n- b\n- c"), /<li[ >]/g)).toBe(3);
    expect(html("1. a\n2. b")).toContain("<ol"); expect(html("1. a\n2. b")).not.toContain("start=");
    expect(html("3. a\n4. b")).toContain('start="3"');
  });
  it("a list right after a line of text, with no blank line between (models write this)", () => {
    const h = html("Files changed:\n- a.py\n- b.py"); expect(h).toContain("<ul"); expect(count(h, /<li[ >]/g)).toBe(2); expect(h).toContain("Files changed:");
  });
  it("nested lists by 2 or 4 spaces, under bullets and numbers", () => {
    const h = html("- a\n  - a1\n  - a2\n- b\n\n1. one\n   - sub\n2. two\n    - deep");
    expect(count(h, /<ul/g)).toBe(4); expect(count(h, /<ol/g)).toBe(1);
    expect(h.indexOf("a1")).toBeGreaterThan(h.indexOf("<ul", h.indexOf("<ul") + 1) - 1);
  });
  it("a wrapped list item continues; a code block inside an item stays inside it", () => {
    const h = html("- first line\n  continues here\n- second\n\n  ```py\n  x = 1\n  ```");
    expect(h).toContain("first line continues here"); expect(h).toContain("md-code-block"); expect(count(h, /<li[ >]/g)).toBe(2);
  });
  it("task lists show a box, checked or not", () => {
    const h = html("- [x] done\n- [ ] todo"); expect(count(h, /class="md-box on"/g)).toBe(1); expect(count(h, /class="md-box"/g)).toBe(1); expect(h).not.toContain("[x]");
  });
  it("a numbered list split by a code block keeps counting", () => {
    const h = html("1. Run:\n```bash\npytest\n```\n2. Next");
    expect(h).toContain('start="2"'); expect(h).toContain("md-code-block");
  });
  it("block quotes, nested content and lazy lines", () => {
    const h = html("> a quote\n> - item\ncontinued\n\nafter"); expect(h).toContain("<blockquote"); expect(h).toContain("<li>"); expect(h).toContain("after");
  });
  it("a fenced block: language label, copy button, content as text; an unclosed fence (still streaming) shows what came so far", () => {
    const h = html("```python\nprint('<b>')\n```\n\ntext"); expect(h).toContain("md-code-lang\">python"); expect(h).toContain("Copy"); expect(h).toContain("&lt;b&gt;"); expect(h).toContain("text");
    const open = html("```js\nconst a = 1"); expect(open).toContain("md-code-block"); expect(open).toContain("const");
  });
  it("a longer fence can contain a shorter one", () => { const h = html("````md\n```py\nx\n```\n````"); expect(count(h, /md-code-block/g)).toBe(1); expect(h).toContain("```py"); });
  it("rules: ---, ***, and * * *", () => { expect(count(html("a\n\n---\n\nb\n\n***\n\n* * *"), /<hr/g)).toBe(3); });
  it("empty and whitespace-only input", () => { expect(html("")).toBe("<div></div>"); expect(html("  \n\n ")).toBe("<div></div>"); });
  it("a very long line does not hang the parser", () => {
    const t0 = Date.now(); html("*".repeat(5000) + " " + "_x ".repeat(3000) + "`".repeat(999)); expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe("syntax highlighting", () => {
  const h = (code: string, lang: string): string => ssr(<code>{highlight(code, lang)}</code>);
  it("python: keywords, strings, comments, numbers, calls", () => {
    const out = h("def f(x):\n    # note\n    return g(x, 'a') + 42", "python");
    expect(out).toContain('<span class="tok-kw">def</span>'); expect(out).toContain('<span class="tok-com"># note</span>'); expect(out).toContain('<span class="tok-str">&#x27;a&#x27;</span>');
    expect(out).toContain('<span class="tok-num">42</span>'); expect(out).toContain('<span class="tok-fn">g</span>'); expect(out).toContain('<span class="tok-fn">f</span>');
  });
  it("a # inside a string is not a comment; a word inside an identifier is not a keyword", () => {
    const out = h('s = "a # b"\nclassify = 1', "py");
    expect(out).not.toContain("tok-com"); expect(out).not.toContain('tok-kw">class</span>ify');
  });
  it("typescript / js strings, template literals and // comments", () => {
    const out = h("const a = `x ${1}`; // hi\nlet b = 'q';", "ts");
    expect(out).toContain('tok-kw">const'); expect(out).toContain("tok-str\">`x ${1}`"); expect(out).toContain('tok-com">// hi');
  });
  it("diff: added, removed and hunk lines", () => {
    const out = h("@@ -1 +1 @@\n-old\n+new\n ctx", "diff");
    expect(out).toContain("tok-hunk"); expect(out).toContain("tok-del"); expect(out).toContain("tok-add");
  });
  it("an unknown language and a huge block come back plain", () => { expect(h("x = 1", "brainfuck")).toBe("<code>x = 1</code>"); expect(h("x".repeat(9000), "py")).not.toContain("<span"); });
  it("text with markup characters is escaped, never injected", () => { const out = h("print('</code><b>x</b>')", "py"); expect(out).not.toContain("<b>"); expect(out).toContain("&lt;/code&gt;"); });
});
