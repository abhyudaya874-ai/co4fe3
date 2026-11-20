// Workflow 07: a real crew round trip through TrueForge dynamic subagents + the fake model.
// The lead calls create_sub_agent (spike row 6/7: { name, input }), the research member is
// denied propose_edit by the profile gate, reports back, and the panel events arrive in order.
import { it, expect } from "vitest";
import { startHarness, toolName } from "./harness.js";
import { Crew } from "../../extensions/co4fe3-vscode/src/panel/crew.js";
import { fromForge, memberMayCall, type TfEvent, type EventIndex } from "../../packages/agent-core/src/index.js";
import type { PanelEvent } from "../../packages/agent-core/src/panel/index.js";
import type { ChatBody } from "../fakes/fake-openai.js";

it("research member is denied propose_edit; member/brief/report rows land in order", async () => {
  let memberCalls = 0;
  let leadCalls = 0;
  const pes: PanelEvent[] = [];
  const events: TfEvent[] = [];
  const crew = new Crew("agent", (e) => pes.push(e));
  const h = await startHarness((body: ChatBody) => {
    // The member's requests start with the brief as a user message ("PROFILE: research").
    const isMember = body.messages.some((m) => m.role === "user" && typeof m.content === "string" && m.content.startsWith("PROFILE:"));
    if (isMember) {
      memberCalls++;
      if (memberCalls === 1)
        return { toolCalls: [{ name: toolName(body, "propose_edit"), args: { path: "src/minipkg/helpers.py", why: "try to edit", edits: [{ old_string: "import", new_string: "import os\nimport" }] } }] };
      return { text: "Report: FlaskGroup.__init__ adds run_command, shell_command and routes_command at cli.py L560-566. My edit was denied." };
    }
    // The lead: first call creates the member, every later call wraps up.
    if (++leadCalls === 1)
      return { toolCalls: [{ name: "create_sub_agent", args: { name: "Find CLI registration", input: "PROFILE: research\nIn src/flask/cli.py find where the built-in commands run. Report under 15 lines with line numbers." } }] };
    return { text: "Done. The member found the registration site." };
  });
  try {
    const out = await h.turn("Where do Flask's built-in commands get registered? Delegate the search.", {
      subAgents: true,
      onEvent: (e: TfEvent, index: EventIndex) => {
        events.push(e);
        for (const pe of fromForge(e, index, { mode: "agent", serverName: h.mcpName })) pes.push(pe);
        crew.onEvent(e);
      },
      // The product's profile gate (panel/pause.ts), mirrored: research members do not call gated tools.
      denyFor: (p, tool) => {
        const m = crew.member(p.threadId);
        return m && tool && !memberMayCall(m.profile, "agent", tool)
          ? `${m.profile} members do not call ${tool}. Report what should change and where; the lead will do it.`
          : null;
      },
    });
    expect(out.status).toBe("done");

    // 1. the lead really called create_sub_agent with { name, input } and a PROFILE: research brief
    const created = events.find((e) => e.type === "thread.created");
    expect(created).toBeTruthy();
    const brief = events.find((e) => e.type === "thread.created" && (e as { agentInfo?: { input?: string } }).agentInfo?.input?.startsWith("PROFILE: research"));
    expect(brief).toBeTruthy();

    // 2. the member's propose_edit was denied, and its next request carries the reason in the tool result
    const memberReqs = h.fake.requests.filter((r) => r.body?.messages.some((m) => m.role === "user" && typeof m.content === "string" && m.content.startsWith("PROFILE:")));
    expect(memberReqs.length).toBeGreaterThanOrEqual(2);
    const afterDeny = memberReqs[1]!.body!;
    const toolMsgs = afterDeny.messages.filter((m) => m.role === "tool");
    expect(JSON.stringify(toolMsgs)).toContain("research members do not call propose_edit");

    // 3. nothing was written: the only writer ran zero applies
    expect(h.applier.last()).toBeUndefined();

    // 4. panel rows: member(running) → to-<thread> → member(completed) → from-<thread>
    const idx = (pred: (e: PanelEvent) => boolean) => pes.findIndex(pred);
    const iRun = idx((e) => e.kind === "member" && e.status === "running");
    const iTo = idx((e) => e.kind === "message" && e.id.startsWith("to-"));
    const iDone = idx((e) => e.kind === "member" && e.status === "completed");
    const iFrom = idx((e) => e.kind === "message" && e.id.startsWith("from-"));
    expect(iRun).toBeGreaterThanOrEqual(0);
    expect(iTo).toBeGreaterThan(iRun);
    expect(iDone).toBeGreaterThan(iTo);
    expect(iFrom).toBeGreaterThan(iDone);
    const member = pes.findLast((e): e is Extract<PanelEvent, { kind: "member" }> => e.kind === "member" && e.status === "completed");   // crew's evidence-checked row lands after fromForge's
    expect(member?.title).toBe("Find CLI registration");
    expect(member?.profile).toBe("research");
  } finally {
    await h.close();
  }
}, 60_000);
