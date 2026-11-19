import { TrueForge } from "@truefoundry/trueforge-sdk";

/** No token in local mode. The 60 s default timeout would kill long SSE turns, so it is raised for streams only. */
export function makeClient(baseUrl: string): TrueForge {
  return new TrueForge({ baseUrl, timeoutInSeconds: 30, maxRetries: 1 });
}
/** Requests that create or change server state are never retried (the SDK default is 2 retries: duplicate turns). */
export const STREAM = { timeoutInSeconds: 600, maxRetries: 0 } as const;
export const ONCE = { timeoutInSeconds: 15, maxRetries: 0 } as const;

/** The session page in TrueForge's UI (spike row 8: the route is `/sessions/:sessionId`). */
export const sessionUrl = (base: string, sessionId: string): string => `${base.replace(/\/$/, "")}/sessions/${sessionId}`;

/** Cheap liveness probe used at activation and before every turn. */
export async function health(client: TrueForge, signal?: AbortSignal): Promise<{ ok: true } | { ok: false; detail: string }> {
  try {
    await client.models.list({ timeoutInSeconds: 3, maxRetries: 0, abortSignal: signal });
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
