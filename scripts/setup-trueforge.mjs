#!/usr/bin/env node
// Registers the model providers from config/providers.json (or the example) in TrueForge. Keys come from the
// environment: every ${NAME} placeholder is replaced with process.env.NAME at run time and never written to disk.
// Usage: npm run setup:trueforge            (register)
//        npm run setup:trueforge -- --check (only list what TrueForge serves)
// Manifest shape: @truefoundry/trueforge-sdk ModelProvidersClient.createOrUpdate (TS SDK, camelCase).
import { readFileSync, existsSync } from "node:fs";
import { TrueForge } from "@truefoundry/trueforge-sdk";

const BASE = process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8790";
const client = new TrueForge({ baseUrl: BASE, timeoutInSeconds: 20, maxRetries: 0 });
const file = existsSync("config/providers.json") ? "config/providers.json" : "config/providers.example.json";
const cfg = JSON.parse(readFileSync(file, "utf8"));

const missing = new Set();
const fill = (v) => JSON.parse(JSON.stringify(v).replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => {
  if (!process.env[k]) { missing.add(k); return "missing"; }
  return process.env[k].replace(/["\\]/g, "");          // keys never contain quotes; refuse to break the JSON
}));

if (!process.argv.includes("--check")) {
  for (const manifest of cfg.providers) {
    const label = manifest.name ?? manifest.type;
    const filled = fill(manifest);
    if (missing.size) { console.error(`skip ${label}: missing env ${[...missing].join(", ")} (see .env.example)`); missing.clear(); continue; }
    try {
      await client.settings.modelProviders.createOrUpdate({ manifest: filled });
      console.log(`ok   ${label}: ${manifest.models.map((m) => m.name).join(", ")}`);
    } catch (e) {
      console.error(`FAIL ${label}: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    }
  }
}

const models = await client.models.list();
// VERIFY the response shape on first run and simplify this line (rule 20: record it in docs/progress/01-spike.md).
console.log(`\nTrueForge at ${BASE} serves:\n${JSON.stringify(models, null, 2)}`);
console.log(`\nSet co4fe3.models.order to: ${JSON.stringify(cfg.order)}`);
