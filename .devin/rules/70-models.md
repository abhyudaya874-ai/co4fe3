---
trigger: always_on
description: Model providers configured in TrueForge (NIM primary, Gemini Flash-Lite fallback), the setup script, failure classification, the automatic fallback state machine for Task C, the user-facing messages, and model switching
---

# Models and fallback (B3, 10 points at "automatic fallback, no user action, workspace unchanged")

## Providers (configured in TrueForge, never in the extension)

| Role | TrueForge provider | FQN | Why (measured in UltraPals, Nov 2026) |
|---|---|---|---|
| primary | `custom` named `nvidia-nim`, base `https://integrate.api.nvidia.com/v1` | `nvidia-nim/nemotron-super` | took 8 parallel requests without a refusal; usable answers in 3.5–9 s |
| fallback | `google-gemini` (catalog type) | `google-gemini/gemini-flash-lite` | answers in 0.8–2 s; free tier allows 15 requests/min per model |
| optional | `custom`: OpenRouter, OmniRoute (`http://localhost:20128/v1`), freellmapi (`http://localhost:3001/v1`), Ollama (`http://localhost:11434/v1`) | — | any OpenAI-compatible endpoint works |

The base URLs come from `/home/de3p/paypal/lib/integrations/chat.ts` (NIM, OpenRouter, Gemini), the OmniRoute README
quickstart, the freellmapi README and Ollama's OpenAI-compatible endpoint. The context lengths in
`providers.example.json` are placeholders. Read each model card and fix them in workflow 08.

Free tiers cost $0. Write that in the write-up (section 5) together with the request limits.

## `config/providers.example.json` → `scripts/setup-trueforge.mjs`

`config/providers.json` is gitignored. Its `${NAME}` placeholders are filled from the environment at setup time,
so keys never touch the repo.

```js
// scripts/setup-trueforge.mjs — node scripts/setup-trueforge.mjs [--check]
import { readFileSync, existsSync } from "node:fs";
import { TrueForge } from "@truefoundry/trueforge-sdk";

const file = existsSync("config/providers.json") ? "config/providers.json" : "config/providers.example.json";
const cfg = JSON.parse(readFileSync(file, "utf8"));
const fill = (v) => JSON.parse(JSON.stringify(v).replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => {
  if (!process.env[k]) { console.error(`missing env ${k} (see .env.example)`); process.exit(2); }
  return process.env[k];
}));
const client = new TrueForge({ baseUrl: process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8790", timeoutInSeconds: 20, maxRetries: 0 });
for (const manifest of cfg.providers) {
  await client.settings.modelProviders.createOrUpdate({ manifest: fill(manifest) });
  console.log(`provider ${manifest.name ?? manifest.type}: ${manifest.models.map((m) => m.name).join(", ")}`);
}
const models = await client.models.list();
console.log("TrueForge now serves:", JSON.stringify(models.data ?? models, null, 2));   // VERIFY the response shape once and fix this line
console.log(`set co4fe3.models.order to: ${JSON.stringify(cfg.order)}`);
```

## Failure classification (`agent-core/src/forge/fallback.ts`). Pure, table-tested against real error strings.

```ts
export type FailKind = "auth" | "not_found" | "rate" | "unreachable" | "stall" | "server" | "context" | "unknown";
export interface Failure { kind: FailKind; benchMs: number; retrySame: boolean; detail: string }

const RULES: [FailKind, RegExp, number, boolean][] = [
  ["auth", /\b(401|403)\b|unauthori[sz]ed|invalid[^.]{0,30}(api[ _-]?key|token|credential)|permission denied/i, 600_000, false],
  ["not_found", /\b404\b|model[^.]{0,40}(not found|does not exist)|unknown model/i, 600_000, false],
  ["rate", /\b429\b|rate.?limit|quota|resource.?exhausted|too many requests/i, 60_000, false],
  ["unreachable", /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|getaddrinfo|fetch failed|connect(ion)? refused|network error|socket hang up|cannot connect/i, 60_000, false],
  ["context", /context.{0,20}(length|window)|maximum context|too many (input )?tokens/i, 0, false],
  ["server", /\b5\d\d\b|overloaded|unavailable|bad gateway|internal server error/i, 30_000, true],
  ["stall", /stall|timed? ?out|ETIMEDOUT|deadline/i, 60_000, true],
];
export function classifyFailure(message: string): Failure {
  for (const [kind, re, benchMs, retrySame] of RULES) if (re.test(message)) return { kind, benchMs: kind === "rate" ? retryAfterMs(message) ?? benchMs : benchMs, retrySame, detail: firstLine(message) };
  return { kind: "unknown", benchMs: 30_000, retrySame: true, detail: firstLine(message) };
}
/** "retry in 57.1s" / "Retry-After: 30" → ms + 500, capped at 1 h. */
export const retryAfterMs = (m: string): number | null => { const x = /retry(?:-after)?[^0-9]{0,12}(\d+(?:\.\d+)?)\s*s/i.exec(m); return x ? Math.min(3_600_000, Math.ceil(Number(x[1]) * 1000) + 500) : null; };
export const backoffMs = (n: number, rand = Math.random): number => Math.min(4000, 500 * 2 ** n) + Math.floor(rand() * 250);
```

The test table (`fallback.test.ts`) uses **the exact strings the spike records** (workflow 01 step 7). It records what
TrueForge reports for a bad key, a bad base URL and a 429, so the regexes match reality instead of a guess.

## The fallback state machine (`agent-core/src/forge/fallback.ts`)

```ts
export interface AttemptResult { outcome: TurnOutcome; sideEffects: boolean; firstTokenMs: number | null }
export type RunOn = (model: string, attempt: number, signal: AbortSignal) => Promise<AttemptResult>;
export type Note = { kind: "attempt"; model: string; n: number } | { kind: "failed"; model: string; failure: Failure; next: string | null } | { kind: "answered"; model: string; fellBack: boolean };

/** Tries models in order. Same model again only for retrySame kinds, once, after backoff. Never retries after a side effect. */
export async function runWithFallback(models: readonly string[], runOn: RunOn, note: (n: Note) => void, signal: AbortSignal, sleep = realSleep): Promise<{ model: string; result: AttemptResult } | { model: null; failures: { model: string; failure: Failure }[] }> {
  const failures: { model: string; failure: Failure }[] = [];
  let n = 0;
  for (const [i, model] of models.entries()) {
    for (let same = 0; same < 2; same++) {
      if (signal.aborted) return { model: null, failures };
      note({ kind: "attempt", model, n: ++n });
      const r = await runOn(model, n, signal);
      const stalled = r.outcome.status === "cancelled" && r.outcome.reason === "stall";   // runOn sets reason "stall" when ITS stall timer fired
      if (signal.aborted || (r.outcome.status === "cancelled" && !stalled)) return { model, result: r };   // the user pressed Stop: no banner, no fallback
      if (r.outcome.status === "done") { note({ kind: "answered", model, fellBack: i > 0 }); return { model, result: r }; }
      const failure: Failure = r.outcome.status === "error" ? classifyFailure(r.outcome.message) : { kind: "stall", benchMs: 60_000, retrySame: false, detail: "no first token in time" };
      failures.push({ model, failure });
      const next = r.sideEffects ? null : (failure.retrySame && same === 0 ? model : models[i + 1] ?? null);
      note({ kind: "failed", model, failure, next });
      if (r.sideEffects) return { model: null, failures };              // a tool already ran: the user decides
      if (!(failure.retrySame && same === 0)) break;                    // move to the next model
      await sleep(backoffMs(same), signal);
    }
  }
  return { model: null, failures };
}
```

`runOn` (extension, `forge/router.ts`) does three things:

1. **Inline edit**: takes the pre-warmed session for `model` from the pool (one per model) and runs `attemptTurn`
   (workflow 08) with two watchdogs: first token within `stallMs(stats[model])`, then no silence longer than
   `IDLE_STALL_MS` (paused during reviews). On a stall it aborts with reason `"stall"`.
2. **Agent mode**: `client.sessions.update(sessionId, { agent: { spec: withModel(spec, model) } })`, then
   `attemptTurn({ previousTurnId: lastFailed?.previousTurnId ?? "none" … })` on the same session (rule 20, trap 7).
   This uses the same watchdogs. A stall before any side effect falls back; after one, the banner offers a retry.
3. **Always**: `record()` into the stats. A failure benches the model for `failure.benchMs`, so the next request
   starts on a healthy model without waiting (UltraPals `cooldownFor`).

`sideEffects` turns true the moment `onPause` answers **allow** to any call. Before that, retrying is invisible to the
workspace.

## What the user sees (`agent-core/src/forge/messages.ts`, pure, snapshot-tested)

```ts
export function failureLine(model: string, f: Failure): string {
  switch (f.kind) {
    case "auth": return `${model} rejected the API key (${f.detail}). Fix it in TrueForge → Settings → Models.`;
    case "not_found": return `${model} does not exist at the provider (${f.detail}).`;
    case "rate": return `${model} is rate-limited; it is skipped for ${Math.ceil(f.benchMs / 1000)} s.`;
    case "unreachable": return `${model} could not be reached (${f.detail}).`;
    case "stall": return `${model} sent nothing in time.`;
    case "context": return `${model} could not fit the request in its context window.`;
    default: return `${model} failed: ${f.detail}`;
  }
}
// banner after a fallback answered:  "⚠ nvidia-nim/nemotron-super rejected the API key (HTTP 401). Answered by google-gemini/gemini-flash-lite."
// banner when every model failed:   "No configured model answered. nemotron-super: invalid key · gemini-flash-lite: rate-limited (41 s). Nothing was changed."  [Retry] [Open TrueForge settings]
```

Messages are never stack traces. The output channel keeps the raw error (redacted, `util/redact.ts`).

## Task C checklist (what the video must show)

1. In TrueForge → Settings → Models, give `nvidia-nim` a wrong key (or a wrong base URL). Do NOT touch co4fe3 settings.
2. Repeat Task A. The status line reads "Waiting for nvidia-nim/nemotron-super…", then the banner names the failure
   and shows "Answered by google-gemini/gemini-flash-lite". The diff streams in. Typing in another editor works the
   whole time.
3. In the terminal, run `git status`: clean (proposals are not on disk). Click **Reject all**. `git status` is still clean.
4. Optional second beat: break the fallback too, then repeat. The "No configured model answered" banner appears with
   the reason per model, and `git status` is clean.

## Switching models (write-up section 5: "how a user switches models")

- Status bar item `$(sparkle) nemotron-super ▾` → QuickPick of `client.models.list()` → sets
  `co4fe3.models.order[0]`. A second pick sets the fallback. The panel header has the same picker.
- Setting `co4fe3.models.order: string[]` (FQNs, first = primary). The list comes from TrueForge. No model name is
  hard-coded in code.
- Adding a provider is TrueForge's job: Settings → Models in its UI, or `npm run setup:trueforge`.
