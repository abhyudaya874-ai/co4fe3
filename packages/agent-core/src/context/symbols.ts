export interface Sym { name: string; kind: "class" | "def" | "function" | "command" | "const"; line: number; sig: string; parent?: string; doc?: string }

const PY_DEF = /^(\s*)(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)\s*(\([^)]*\)?[^:]*)?:/;
const PY_CMD = /^\s*@[\w.]+\.command\(\s*["']([\w-]+)["']/;     // click: @click.command("routes") → a "command" symbol
const TS_DEF = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(function|class|const|interface|type)\s+([A-Za-z_$][\w$]*)/;

export function extractSymbols(path: string, text: string): Sym[] {
  const lines = text.split("\n");
  const out: Sym[] = [];
  const stack: { indent: number; name: string }[] = [];
  lines.forEach((raw, i) => {
    if (path.endsWith(".py")) {
      const cmd = PY_CMD.exec(raw);
      if (cmd) out.push({ name: cmd[1]!, kind: "command", line: i + 1, sig: raw.trim() });
      const m = PY_DEF.exec(raw);
      if (!m) return;
      const indent = m[1]!.length;
      while (stack.length && stack.at(-1)!.indent >= indent) stack.pop();
      const doc = /^\s*[rub]?("""|''')(.*)/.exec(lines[i + 1] ?? "")?.[2]?.replace(/("""|''')\s*$/, "").trim();
      out.push({ name: m[3]!, kind: m[2] === "class" ? "class" : "def", line: i + 1, sig: raw.trim().slice(0, 160), parent: stack.at(-1)?.name, doc: doc || undefined });
      if (m[2] === "class") stack.push({ indent, name: m[3]! });
    } else if (/\.(m?[jt]sx?)$/.test(path)) {
      const m = TS_DEF.exec(raw);
      if (m) out.push({ name: m[2]!, kind: m[1] === "class" ? "class" : m[1] === "function" ? "function" : "const", line: i + 1, sig: raw.trim().slice(0, 160) });
    }
  });
  return out;
}
