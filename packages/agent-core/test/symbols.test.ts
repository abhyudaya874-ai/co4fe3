import { describe, it, expect } from "vitest";
import { extractSymbols } from "../src/context/symbols.js";

describe("extractSymbols (python)", () => {
  const src = [
    '"""Module docstring."""',
    "",
    "class AppGroup:",
    '    """The group."""',
    "    def __init__(self):",
    "        pass",
    "",
    '@click.command("routes", short_help="Show routes.")',
    "def routes_command() -> None:",
    '    """List the routes."""',
    "    pass",
    "",
    "async def helper():",
    "    pass",
  ].join("\n");
  const syms = extractSymbols("cli.py", src);

  it("finds classes, defs, click commands and docstring first lines", () => {
    const names = syms.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["AppGroup", "__init__", "routes", "routes_command", "helper"]));
    expect(syms.find((s) => s.name === "routes")!.kind).toBe("command");
    expect(syms.find((s) => s.name === "routes_command")!.doc).toBe("List the routes.");
  });

  it("methods carry their class as parent", () => {
    expect(syms.find((s) => s.name === "__init__")!.parent).toBe("AppGroup");
    expect(syms.find((s) => s.name === "routes_command")!.parent).toBeUndefined();
  });
});

describe("extractSymbols (typescript)", () => {
  it("finds functions, classes, consts, interfaces and types", () => {
    const syms = extractSymbols("a.ts", "export function f(): void {}\nconst g = 1;\nexport default class C {}\ninterface I {}\ntype T = string;\nexport async function h() {}\n");
    const names = syms.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["f", "g", "C", "I", "T", "h"]));
    expect(syms.find((s) => s.name === "C")!.kind).toBe("class");
    expect(syms.find((s) => s.name === "g")!.kind).toBe("const");
  });
});
