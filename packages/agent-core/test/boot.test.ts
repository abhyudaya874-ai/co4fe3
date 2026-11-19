import { it, expect } from "vitest";
import * as core from "../src/index.js";

it("loads the agent-core entry without touching vscode or the network", () => {
  expect(typeof core).toBe("object");
});
