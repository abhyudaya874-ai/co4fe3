import { describe, it, expect } from "vitest";
import { CheckpointLog } from "../src/review/checkpoints.js";

it("push assigns ids, last skips undone, ofTurn is newest-first, markUndone sticks", () => {
  const log = new CheckpointLog(() => 1000);
  const a = log.push({ path: "a.py", before: "x", after: "y", turnId: "t1", reason: "r" });
  const b = log.push({ path: "b.py", before: null, after: "new", turnId: "t1", reason: "r" });
  expect(a.id).not.toBe(b.id);
  expect(log.last()?.path).toBe("b.py");
  expect(log.ofTurn("t1").map((c) => c.path)).toEqual(["b.py", "a.py"]);
  log.markUndone(b.id);
  expect(log.last()?.path).toBe("a.py");
  expect(log.ofTurn("t1").map((c) => c.path)).toEqual(["a.py"]);
  expect(log.get(b.id)?.undone).toBe(true);
});

it("toJSON keeps the last 200", () => {
  const log = new CheckpointLog(() => 1);
  for (let i = 0; i < 250; i++) log.push({ path: `f${i}`, before: "a", after: "b", turnId: "t", reason: "r" });
  expect(log.toJSON().length).toBe(200);
  expect(log.toJSON()[0]?.path).toBe("f50");
});
