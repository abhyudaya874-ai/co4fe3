import * as vscode from "vscode";
import { suite, test } from "mocha";
import * as assert from "node:assert";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrueForge } from "@truefoundry/trueforge-sdk";
import { startFakeOpenAI, type FakeModel } from "../../../test/fakes/fake-openai.js";

let TF = process.env.CO4FE3_TF_URL ?? "http://localhost:8790";
let ownServer: { child: ReturnType<typeof spawn>; dir: string } | null = null;

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => { const { port } = srv.address() as { port: number }; srv.close(() => resolve(port)); });
    srv.on("error", reject);
  });

/** Uses TrueForge at :8790 when it is up; otherwise boots a throwaway instance (same pinned build). */
async function ensureTrueforge(): Promise<void> {
  try {
    const r = await fetch(`${TF}/api/v1/docs`, { signal: AbortSignal.timeout(2000) });
    if (r.ok) return;
  } catch { /* fall through and boot one */ }
  const dir = await mkdtemp(join(tmpdir(), "co4fe3-e2e-"));
  const port = await freePort();
  const child = spawn("npx", ["--yes", "@truefoundry/trueforge@0.185.1", "--port", String(port)], {
    env: { ...process.env, SQLITE_PATH: join(dir, "tf.sqlite"), APP_DATA_DIR_SUFFIX: `-e2e-${port}`, OUTBOUND_URL_ALLOWED_HOSTS: '["127.0.0.1", "localhost"]' },
    stdio: "ignore",
  });
  const url = `http://localhost:${port}`;
  const client = new TrueForge({ baseUrl: url, timeoutInSeconds: 3, maxRetries: 0 });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try { await client.models.list(); break; } catch {
      if (Date.now() > deadline) throw new Error(`the e2e's own TrueForge did not come up on ${url}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  TF = url;
  ownServer = { child, dir };
}

const FILE = "src/minipkg/helpers.py";
const BEFORE = [
  '"""Small helpers shared by the CLI, in the shape of flask.helpers."""',
  "",
  "from __future__ import annotations",
  "",
  "import os",
  "",
  'FALSE_VALUES = {"0", "false", "no"}',
  "",
  "",
  'def get_verbose_flag(key: str = "MINIPKG_VERBOSE") -> bool:',
  '    """Return True when the environment variable ``key`` is set to a truthy value.',
  "",
  '    The values ``"0"``, ``"false"`` and ``"no"`` count as false. Any other',
  '    non-empty value counts as true; an unset variable is false.',
  '    """',
  '    value = os.environ.get(key, "")',
  '    return value.strip().lower() not in FALSE_VALUES and value != ""',
  "",
].join("\n");

suite("inline edit (Task A shape)", () => {
  let fake: FakeModel | null = null;
  let providerName = "";

  suiteSetup(async function () {
    this.timeout(90_000);
    await ensureTrueforge();
    // The scripted model: the first request (the inline prompt) returns a fenced replacement of the return lines.
    fake = await startFakeOpenAI((body) => (body.messages.at(-1)?.role === "user"
      ? { text: "```python\n    value = os.environ.get(key, \"\")\n    return value.strip().lower() not in FALSE_VALUES and value != \"\"\n```\n" }
      : { text: "Done." }));
    const client = new TrueForge({ baseUrl: TF, timeoutInSeconds: 20, maxRetries: 0 });
    providerName = `fake-e2e-${Date.now().toString(36)}`;
    await client.settings.modelProviders.createOrUpdate({
      manifest: { type: "custom", name: providerName, baseUrl: fake.url, auth: { apiKey: "fake" }, models: [{ name: "scripted", modelId: "scripted", properties: {} }] },
    }, { timeoutInSeconds: 15, maxRetries: 0 });
    const cfg = vscode.workspace.getConfiguration("co4fe3");
    await cfg.update("trueforge.url", TF, vscode.ConfigurationTarget.Workspace);
    await cfg.update("models.order", [`${providerName}/scripted`], vscode.ConfigurationTarget.Workspace);
    // Wait until the extension registered its editor MCP server with THIS TrueForge (the setting change triggers it).
    const regDeadline = Date.now() + 30_000;
    for (;;) {
      try {
        const servers = await client.mcpServers.list({ timeoutInSeconds: 5, maxRetries: 0 });
        const names = JSON.stringify(servers);
        if (names.includes("co4fe3-ws-")) break;
      } catch { /* not yet */ }
      if (Date.now() > regDeadline) throw new Error("the extension never registered its editor MCP server");
      await new Promise((r) => setTimeout(r, 500));
    }
  });

  suiteTeardown(async function () {
    this.timeout(30_000);
    try {
      const client = new TrueForge({ baseUrl: TF, timeoutInSeconds: 10, maxRetries: 0 });
      await client.settings.modelProviders.delete(providerName);
    } catch { /* the server may be gone already */ }
    await fake?.close();
    const cfg = vscode.workspace.getConfiguration("co4fe3");
    await cfg.update("models.order", undefined, vscode.ConfigurationTarget.Workspace);
    await cfg.update("trueforge.url", undefined, vscode.ConfigurationTarget.Workspace);
    if (ownServer) {
      ownServer.child.kill("SIGTERM");
      setTimeout(() => ownServer?.child.kill("SIGKILL"), 3000).unref();
      await rm(ownServer.dir, { recursive: true, force: true });
      ownServer = null;
    }
  });

  test("streams a diff, accept writes the hunk, undo restores the bytes", async function () {
    this.timeout(60_000);
    const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0]!.uri, FILE);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc);
    await editor.edit((b) => b.replace(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(doc.lineCount, 0)), BEFORE));
    // Select the whole function (the def line through the return).
    const start = BEFORE.indexOf("def get_verbose_flag");
    const startLine = BEFORE.slice(0, start).split("\n").length - 1;
    const endLine = BEFORE.split("\n").length - 2;
    editor.selection = new vscode.Selection(new vscode.Position(startLine, 0), new vscode.Position(endLine, BEFORE.split("\n")[endLine]!.length));
    console.log("[inline.test] firing inlineEdit");
    // The command resolves only after the review; drive the review while it runs.
    const doneP = vscode.commands.executeCommand("co4fe3.inlineEdit", { instruction: "keep the function but return early when the value is empty" }) as Promise<unknown>;
    doneP.then(() => console.log("[inline.test] command resolved"), (e) => console.log("[inline.test] command rejected", String(e).slice(0, 200)));

    // The diff tab opened with our proposal scheme (diff tabs expose original/modified, not uri).
    const deadline = Date.now() + 30_000;
    let proposalTab = false;
    while (Date.now() < deadline && !proposalTab) {
      proposalTab = vscode.window.tabGroups.all.some((g) => g.tabs.some((t) => {
        const input = t.input as { uri?: vscode.Uri; original?: vscode.Uri; modified?: vscode.Uri };
        return input.uri?.scheme === "co4fe3-proposal" || input.modified?.scheme === "co4fe3-proposal" || input.original?.scheme === "co4fe3-proposal";
      }));
      if (!proposalTab) await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(proposalTab, "the proposal diff tab never opened");

    // Wait until the proposal is STAGED: the CodeLens provider answers only once hunks are pending.
    const proposalUri = vscode.window.tabGroups.all.flatMap((g) => g.tabs.map((t) => (t.input as { modified?: vscode.Uri }).modified)).find((u) => u?.scheme === "co4fe3-proposal")!;
    const lensDeadline = Date.now() + 30_000;
    let staged = false;
    while (Date.now() < lensDeadline && !staged) {
      const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>("vscode.executeCodeLensProvider", proposalUri);
      staged = !!lenses && lenses.length > 0;
      if (!staged) await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(staged, "the proposal was never staged (no CodeLens appeared)");

    // Accept all hunks; the review settles and the applier writes.
    await vscode.commands.executeCommand("co4fe3.proposal.acceptAll");
    await doneP;
    const applied = Date.now() + 30_000;
    let changed = false;
    while (Date.now() < applied && !changed) {
      const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      changed = text !== BEFORE;
      if (!changed) await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(changed, "accepting the hunk never wrote the file");

    // Undo restores the exact bytes.
    await vscode.commands.executeCommand("co4fe3.undoLast");
    const restored = Date.now() + 15_000;
    let same = false;
    while (Date.now() < restored && !same) {
      const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      same = text === BEFORE;
      if (!same) await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(same, "undo did not restore the original bytes");
  });
});
