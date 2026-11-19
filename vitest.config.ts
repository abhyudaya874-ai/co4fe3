import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["packages/*/test/**/*.test.ts"], exclude: ["**/perf/**"], environment: "node" } },
      { test: { name: "perf", include: ["packages/*/test/perf/**/*.perf.test.ts"], environment: "node" } },
      { test: { name: "integration", include: ["test/integration/**/*.test.ts"], globalSetup: ["test/integration/global-setup.ts"], testTimeout: 60_000, hookTimeout: 90_000, fileParallelism: false } },
    ],
  },
});
