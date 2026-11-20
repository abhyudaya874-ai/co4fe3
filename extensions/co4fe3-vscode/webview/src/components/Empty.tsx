import { Logo } from "./Icon.js";

// Starting points that work on any project. They fill the box; the person decides whether to send.
const IDEAS = [
  "Give me a tour of this codebase",
  "Find where errors are handled and explain the flow",
  "Review the file I have open and suggest improvements",
];

export function Empty({ surface, folder, onPick }: { surface: "agent" | "dock"; folder: string; onPick(text: string): void }) {
  return (
    <div className={`empty ${surface}`}>
      <Logo size={surface === "agent" ? 34 : 26} />
      <h1>{surface === "agent" ? "What should we work on?" : "Ask co4fe3"}</h1>
      <p className="muted">{folder ? <>Working in <strong>{folder}</strong>. </> : null}Every change is shown as a diff first, and nothing is written until you accept it.</p>
      <div className="ideas">
        {IDEAS.map((t) => <button key={t} type="button" className="idea" onClick={() => onPick(t)}>{t}</button>)}
      </div>
    </div>
  );
}
