import { useActions } from "../actions.js";
import { Icon } from "./Icon.js";

/** Above the composer while edits wait for a decision: how many files, the totals, and Accept all / Reject all for every one of them. */
export function ReviewBar({ keys, files, adds, removes }: { keys: string[]; files: number; adds: number; removes: number }) {
  const { decideAll, openDiff } = useActions();
  if (!keys.length) return null;
  return (
    <div className="review-bar" role="region" aria-label="Edits waiting for review">
      <span className="review-count"><Icon name="edit" size={13} />{files} file{files === 1 ? "" : "s"}<span className="add">+{adds}</span><span className="del">−{removes}</span></span>
      <span className="spacer" />
      <button type="button" className="btn small ghost" onClick={() => openDiff(keys[0]!)} title="Open the first one in the editor">Quick review</button>
      <button type="button" className="btn small" onClick={() => keys.forEach((k) => decideAll(k, "rejected"))}>Reject all</button>
      <button type="button" className="btn small primary" onClick={() => keys.forEach((k) => decideAll(k, "accepted"))}>Accept all</button>
    </div>
  );
}
