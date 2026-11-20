import { createContext, useContext } from "react";

/** What a row can ask the host to do. App provides it once; rows read it, so no row needs its own callbacks. */
export interface Actions {
  decide(key: string, hunkId: string, verdict: "accepted" | "rejected"): void;
  decideAll(key: string, verdict: "accepted" | "rejected"): void;
  openDiff(key: string): void;
  openFile(path: string, line?: number): void;
  command(id: string, verdict: "allow" | "deny"): void;
  undo(checkpointId: string): void;
}

const none = (): void => undefined;
export const NO_ACTIONS: Actions = { decide: none, decideAll: none, openDiff: none, openFile: none, command: none, undo: none };
export const ActionsContext = createContext<Actions>(NO_ACTIONS);
export const useActions = (): Actions => useContext(ActionsContext);
