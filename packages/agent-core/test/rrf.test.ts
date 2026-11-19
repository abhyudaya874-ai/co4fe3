import { describe, it, expect } from "vitest";
import { rrfMerge } from "../src/context/rrf.js";

describe("rrfMerge", () => {
  it("1st + 50th beats a single 1st", () => {
    const lone = Array.from({ length: 50 }, (_, i) => (i === 49 ? "both" : `a${i}`));
    const r = rrfMerge([lone, ["other", "both"]]);
    expect(r[0]!.id).toBe("both");
    expect(r.find((x) => x.id === "other")!.score).toBeLessThan(r[0]!.score);
  });

  it("an empty channel changes nothing", () => {
    const a = rrfMerge([["x", "y"], []]);
    const b = rrfMerge([["x", "y"]]);
    expect(a.map((f) => [f.id, f.score])).toEqual(b.map((f) => [f.id, f.score]));
  });

  it("duplicates within a channel are ignored", () => {
    const r = rrfMerge([["x", "x", "x", "y"]]);
    expect(r.find((f) => f.id === "x")!.ranks[0]).toBe(1);
    expect(r.find((f) => f.id === "y")!.ranks[0]).toBe(4);
  });

  it("ties sort by id", () => {
    const r = rrfMerge([["b", "a"], ["a", "b"]]);
    expect(r.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("k <= 0 throws", () => {
    expect(() => rrfMerge([["x"]], 0)).toThrow();
  });

  it("each item's ranks array is correct", () => {
    const r = rrfMerge([["x", "y"], ["y", "z"], []]);
    expect(r.find((f) => f.id === "y")!.ranks).toEqual([2, 1, 0]);
    expect(r.find((f) => f.id === "z")!.ranks).toEqual([0, 2, 0]);
    expect(r.find((f) => f.id === "x")!.ranks).toEqual([1, 0, 0]);
  });
});
