import { describe, it, expect } from "vitest";
import { formatCommandResult, parseCommandResult } from "../src/mcp/commandResult.js";

describe("run_command result text", () => {
  it("round-trips: what the model is told is what the card shows", () => {
    const text = formatCommandResult({ exitCode: 0, ms: 412, timedOut: null, killed: false }, "55 passed, 3 skipped in 0.41s\n");
    expect(text).toBe("exit 0 · 0.4 s\n55 passed, 3 skipped in 0.41s\n");
    expect(parseCommandResult(text)).toEqual({ exit: 0, seconds: 0.4, timedOut: null, killed: false, output: "55 passed, 3 skipped in 0.41s\n" });
  });
  it("a failing command keeps its exit code and its output", () => {
    const p = parseCommandResult(formatCommandResult({ exitCode: 2, ms: 1500, timedOut: null, killed: false }, "FAILED tests/test_cli.py::test_x\n"));
    expect(p).toMatchObject({ exit: 2, seconds: 1.5, output: "FAILED tests/test_cli.py::test_x\n" });
  });
  it("a timeout and a kill are reported, and the 'do not assume' sentence is not part of the output", () => {
    const text = formatCommandResult({ exitCode: null, ms: 120_000, timedOut: "wall_clock", killed: true }, "partial output");
    expect(text).toContain("do NOT assume it succeeded");
    expect(parseCommandResult(text)).toEqual({ exit: null, seconds: 120, timedOut: "wall_clock", killed: true, output: "partial output" });
  });
  it("no output at all", () => { expect(parseCommandResult(formatCommandResult({ exitCode: 0, ms: 10, timedOut: null, killed: false }, ""))).toMatchObject({ exit: 0, output: "" }); });
  it("text in another shape (a refusal, an error) is returned whole", () => {
    const refusal = "Refused by the command policy: sudo is not allowed. Tests and builds only.";
    expect(parseCommandResult(refusal)).toEqual({ exit: null, seconds: null, timedOut: null, killed: false, output: refusal });
    expect(parseCommandResult("").output).toBe("");
  });
  it("a command whose own first line looks like a status line is still parsed from OUR line", () => {
    const p = parseCommandResult(formatCommandResult({ exitCode: 1, ms: 100, timedOut: null, killed: false }, "exit 0 · 9.9 s\nlooks like ours"));
    expect(p).toMatchObject({ exit: 1, output: "exit 0 · 9.9 s\nlooks like ours" });
  });
});
