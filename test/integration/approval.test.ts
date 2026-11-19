import { it, expect } from "vitest";
import { applyHunks, toHunks, planEdit, type EditOp } from "../../packages/agent-core/src/index.js";
import { startHarness, toolName, type Harness } from "./harness.js";

const EDIT_ONE: EditOp = { oldString: 'FALSE_VALUES = {"0", "false", "no"}', newString: 'FALSE_VALUES = {"0", "false", "no", "off"}' };
const EDIT_TWO: EditOp = { oldString: "import os\n", newString: "import os\nimport sys\n" };

it("writes only the accepted hunk, and Undo restores the exact bytes", async () => {
  const h = await startHarness((body, n) => n === 0
    ? { toolCalls: [{ name: toolName(body, "propose_edit"), args: { path: "src/minipkg/helpers.py", why: "accept off and n", edits: [{ old_string: EDIT_ONE.oldString, new_string: EDIT_ONE.newString }, { old_string: EDIT_TWO.oldString, new_string: EDIT_TWO.newString }] } }] }
    : { text: "Done." });
  const before = await h.read("src/minipkg/helpers.py");
  const out = await h.turn("treat off and n as false", { onReview: (p) => ({ accept: [p.hunks[0]!.id] }) });   // reviewer accepts h1 only
  expect(out.status).toBe("done");
  const planned = planEdit(before, [EDIT_ONE, EDIT_TWO]);
  expect(planned.ok).toBe(true);
  if (planned.ok) expect(await h.read("src/minipkg/helpers.py")).toBe(applyHunks(before, toHunks(before, planned.after), new Set(["h1"])));
  await h.applier.undo(h.applier.last()!.id);
  expect(await h.read("src/minipkg/helpers.py")).toBe(before);
  await h.close();
});

it("an all-rejected proposal writes nothing and the turn still ends", async () => {
  const h: Harness = await startHarness((body, n) => n === 0
    ? { toolCalls: [{ name: toolName(body, "propose_edit"), args: { path: "src/minipkg/helpers.py", why: "reject me", edits: [{ old_string: EDIT_ONE.oldString, new_string: EDIT_ONE.newString }] } }] }
    : { text: "Done." });
  const before = await h.read("src/minipkg/helpers.py");
  const out = await h.turn("reject everything", { onReview: () => ({ accept: [] }) });
  expect(out.status).toBe("done");
  expect(await h.read("src/minipkg/helpers.py")).toBe(before);
  expect(h.applier.last()).toBeUndefined();
  await h.close();
});
