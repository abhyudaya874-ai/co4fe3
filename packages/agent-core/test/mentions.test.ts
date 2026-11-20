import { describe, it, expect } from "vitest";
import { indexFile, buildIndex } from "../src/context/repomap.js";
import { parseMentions } from "../src/context/mentions.js";

const ix = buildIndex([
  indexFile("src/flask/cli.py", "class FlaskGroup:\n    pass\n@click.command(\"routes\")\ndef routes_command():\n    pass\n"),
  indexFile("src/flask/helpers.py", "def get_debug_flag():\n    return True\n"),
]);

describe("parseMentions", () => {
  it("pins a file mention by exact path", () => {
    const r = parseMentions("change @src/flask/cli.py please", ix);
    expect(r.pins).toEqual([{ kind: "file", path: "src/flask/cli.py" }]);
    expect(r.clean).not.toContain("@src/flask/cli.py");
    expect(r.unresolved).toEqual([]);
  });

  it("pins a file mention by basename", () => {
    const r = parseMentions("look at @helpers.py", ix);
    expect(r.pins).toEqual([{ kind: "file", path: "src/flask/helpers.py" }]);
  });

  it("pins a symbol mention at its definition", () => {
    const r = parseMentions("extend @symbol:FlaskGroup", ix);
    expect(r.pins).toEqual([{ kind: "symbol", name: "FlaskGroup", path: "src/flask/cli.py", line: 1 }]);
  });

  it("unknown mentions stay in the text and come back unresolved", () => {
    const r = parseMentions("fix @no/such/file.py and @symbol:Missing", ix);
    expect(r.unresolved.sort()).toEqual(["no/such/file.py", "symbol:Missing"].sort());
    expect(r.clean).toContain("@no/such/file.py");
    expect(r.pins).toEqual([]);
  });

  it("a folder mention keeps the folder in the text and ranks its files; @rule:/@skill: are left for the instructions", () => {
    const r = parseMentions("explain @src/flask/ and use @rule:style", ix);
    expect(r.folders).toEqual(["src/flask"]);
    expect(r.folderFiles).toEqual(["src/flask/cli.py", "src/flask/helpers.py"]);
    expect(r.clean).toContain("src/flask/"); expect(r.clean).not.toContain("@src/flask/");
    expect(r.clean).toContain("@rule:style"); expect(r.unresolved).toEqual([]);
  });

  it("a message with no mentions is unchanged", () => {
    const r = parseMentions("plain request, no at signs", ix);
    expect(r.clean.trim()).toBe("plain request, no at signs");
    expect(r.pins).toEqual([]);
  });
});
