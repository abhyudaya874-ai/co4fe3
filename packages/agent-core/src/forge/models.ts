import { percentile, type ModelStat } from "../latency/stats.js";
import type { ModelRow } from "../panel/protocol.js";

/** A model TrueForge serves (`models.list`). */
export interface ServedModel { name: string; contextLength?: number }

export const providerOf = (fqn: string): string => (fqn.includes("/") ? fqn.slice(0, fqn.indexOf("/")) : "");
export const shortName = (fqn: string): string => fqn.split("/").at(-1) ?? fqn;

/**
 * The model order the router tries. Pure.
 *  - `pick`: what the user chose in the chat's model menu (wins over everything, if TrueForge serves it).
 *  - `configured`: `co4fe3.models.order`.
 *  - `explicit`: the user set `models.order` themselves. Then it is used exactly, and nothing is added behind it.
 *    Left at its default, names TrueForge does not serve are skipped and the order is padded with other served
 *    models (a different provider first), so a fallback exists.
 * With no served list yet (TrueForge still starting), the configured names are returned as they are.
 */
export function resolveModelOrder(o: { pick: string | null; configured: readonly string[]; explicit: boolean; served: readonly string[]; max?: number }): string[] {
  const max = o.max ?? 3;
  const uniq = (xs: readonly string[]): string[] => [...new Set(xs)];
  if (!o.served.length) return uniq([...(o.pick ? [o.pick] : []), ...o.configured]).slice(0, max);   // nothing to check against yet
  const isServed = (m: string): boolean => o.served.includes(m);
  // A list the user wrote is theirs: it may name a model registered a moment ago, so it is not checked against `served`.
  let order = o.explicit ? uniq(o.configured) : uniq(o.configured.filter(isServed));
  const pick = o.pick && isServed(o.pick) ? o.pick : null;                 // a pick comes from the menu of served models; a stale one is ignored
  if (pick) order = [pick, ...order.filter((m) => m !== pick)];
  if (!order.length) order = o.served.slice(0, 2).map((m) => m);            // the default names are not served: use what is there
  if (!o.explicit || pick) {
    const lead = providerOf(order[0] ?? "");
    const others = o.served.filter((m) => !order.includes(m));
    const elsewhere = others.filter((m) => providerOf(m) !== lead);
    order = uniq([...order, ...elsewhere, ...others]);
  }
  return order.slice(0, max);
}

/** The model menu's rows. Stats are the Router's own; `recent` lists models that answered here, newest first. */
export function modelRows(served: readonly ServedModel[], stats: Readonly<Record<string, ModelStat>>, now: number, recent: readonly string[]): ModelRow[] {
  return served.map((m): ModelRow => {
    const s = stats[m.name];
    const p50 = s && s.ttft.length >= 3 ? percentile(s.ttft, 50) : null;
    const left = s && s.benchedUntil > now ? Math.max(1, Math.ceil((s.benchedUntil - now) / 60_000)) : null;
    return {
      name: m.name, provider: providerOf(m.name), short: shortName(m.name),
      p50Ms: p50, ok: s?.ok ?? 0, failed: s?.fail ?? 0, benchedMin: left,
      contextLength: m.contextLength ?? null, recent: recent.includes(m.name),
    };
  });
}
