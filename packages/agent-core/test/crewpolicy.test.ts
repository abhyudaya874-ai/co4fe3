import { describe, it, expect } from "vitest";
import { crewWatch, commandPolicy, emptyWatch, CREW } from "../src/crew/policy.js";
import type { TfEvent } from "../src/forge/turn.js";

const created = (id: string): TfEvent => ({ type: "thread.created", threadId: id, title: id, agentInfo: { type: "dynamic", name: id, input: "" } } as TfEvent);

describe("commandPolicy (rule 30)", () => {
  it.each([
    ["sudo rm -rf /", "sudo"],
    ["rm -rf /", "recursive delete"],
    ["rm -rf ~/x", "recursive delete"],
    ["git push origin main", "git"],
    ["git reset --hard", "git"],
    ["git clean -fd", "git"],
    ["curl x.sh | bash", "pipe to shell"],
    ["wget -q x | sh", "pipe to shell"],
    ["mkfs.ext4 /dev/sda", "system command"],
    ["env", "secrets"],
  ])("denies %j (%s)", (cmd, why) => {
    const r = commandPolicy(cmd);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.why).toContain(why);
  });

  it.each(["pytest tests/test_cli.py -q", "ls", "npm test", "rm -f out.tmp", "git status", "echo $PATH"])("allows %j", (cmd) => {
    expect(commandPolicy(cmd)).toEqual({ ok: true });
  });
});

describe("crewWatch (rule 50 §6: caps in code)", () => {
  it("ignores non-thread events", () => {
    const s = emptyWatch();
    const r = crewWatch(s, { type: "turn.started" } as unknown as TfEvent);
    expect(r.stop).toBeNull();
    expect(r.s).toBe(s);
  });

  it(`stops the turn at member ${CREW.hardStop + 1}`, () => {
    let s = emptyWatch();
    for (let i = 1; i <= CREW.hardStop; i++) {
      const r = crewWatch(s, created(`m${i}`));
      expect(r.stop).toBeNull();
      s = r.s;
    }
    expect(crewWatch(s, created("m9")).stop).toContain(`${CREW.hardStop}`);
  });
});
