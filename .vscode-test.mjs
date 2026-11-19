import { defineConfig } from "@vscode/test-cli";
export default defineConfig({
  files: "extensions/co4fe3-vscode/out/test/**/*.test.js",
  extensionDevelopmentPath: "extensions/co4fe3-vscode",
  workspaceFolder: "test/fixtures/minipkg",
  mocha: { timeout: 60_000 },
});
