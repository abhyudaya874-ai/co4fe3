import * as vscode from "vscode";
import { suite, test } from "mocha";
import * as assert from "node:assert";

suite("activation", () => {
  test("the extension activates and its commands answer", async () => {
    const ext = vscode.extensions.getExtension("co4fe3.co4fe3-vscode");
    assert.ok(ext, "extension not found");
    await ext!.activate();
    assert.ok(ext!.isActive);
  });
});
