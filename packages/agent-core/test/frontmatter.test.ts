import { describe, it, expect } from "vitest";
import { parseFrontmatter, listAttr, boolAttr } from "../src/instructions/frontmatter.js";

describe("parseFrontmatter (rule 85)", () => {
  it("scalars, [a, b] lists and - item lists", () => {
    const f = parseFrontmatter(`---\nname: x\nglobs: [a/**, b.py]\nkeywords:\n  - alpha\n  - beta\n---\nbody`);
    expect(f.attrs.name).toBe("x");
    expect(f.attrs.globs).toEqual(["a/**", "b.py"]);
    expect(f.attrs.keywords).toEqual(["alpha", "beta"]);
    expect(f.body).toBe("body");
  });

  it("quoted values", () => {
    const f = parseFrontmatter(`---\ndescription: "quoted value"\nsingle: 'sq'\n---\nx`);
    expect(f.attrs.description).toBe("quoted value");
    expect(f.attrs.single).toBe("sq");
  });

  it("a nested triggers: block → triggers.globs", () => {
    const f = parseFrontmatter(`---\nname: s\ntriggers:\n  globs: [src/**]\n  keywords: [latency]\n---\nx`);
    expect(listAttr(f.attrs, "globs")).toEqual(["src/**"]);
    expect(listAttr(f.attrs, "keywords")).toEqual(["latency"]);
  });

  it("description: >- folds over lines", () => {
    const f = parseFrontmatter(`---\ndescription: >-\n  first line\n  second line\n---\nx`);
    expect(f.attrs.description).toBe("first line second line");
  });

  it("description: | keeps newlines", () => {
    const f = parseFrontmatter(`---\ndescription: |\n  line one\n  line two\n---\nx`);
    expect(f.attrs.description).toBe("line one\nline two");
  });

  it("no frontmatter at all → empty attrs, whole body", () => {
    const f = parseFrontmatter("# just markdown\n");
    expect(f.attrs).toEqual({});
    expect(f.body).toBe("# just markdown\n");
  });

  it("CRLF endings", () => {
    const f = parseFrontmatter("---\r\nname: cr\r\n---\r\nbody");
    expect(f.attrs.name).toBe("cr");
    expect(f.body).toBe("body");
  });

  it("a malformed line is ignored, never thrown", () => {
    const f = parseFrontmatter(`---\n=== not yaml ===\nname: ok\n---\nx`);
    expect(f.attrs.name).toBe("ok");
  });
});
