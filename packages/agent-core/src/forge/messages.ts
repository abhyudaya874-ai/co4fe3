import type { Failure, Note } from "./fallback.js";

const short = (fqn: string): string => fqn.split("/").at(-1) ?? fqn;

/** One honest sentence per failure kind (rule 70 §"what the user sees"). Never a stack trace. */
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

/** The note stream → one log/status line per event (output channel + model rows). */
export function noteLine(n: Note): string {
  switch (n.kind) {
    case "attempt": return `attempt ${n.n}: ${n.model}`;
    case "failed": return `${n.model} failed — ${n.failure.detail}${n.next ? `; next: ${n.next}` : " (a tool already ran: not retrying)"}`;
    case "answered": return n.fellBack ? `⚠ Answered by ${n.model} (first model failed).` : `Answered by ${n.model}.`;
  }
}

/** Every model failed: the banner names each failure, per the rule-70 example. Nothing was changed. */
export function allFailedLine(failures: { model: string; failure: Failure }[]): string {
  const parts = failures.map(({ model, failure }) => `${short(model)}: ${failure.kind === "rate" ? `rate-limited (${Math.ceil(failure.benchMs / 1000)} s)` : failure.detail}`);
  return `No configured model answered. ${parts.join(" · ")}. Nothing was changed.`;
}

/** The fallback banner after another model answered: names what failed and who answered. */
export function fallbackBanner(model: string, f: Failure, answered: string): string {
  return `⚠ ${failureLine(model, f)} Answered by ${answered}.`;
}
