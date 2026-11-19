import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./main.css";

// Mounts the panel and owns acquireVsCodeApi() (the vscode-extension skill: once, here).
const api = acquireVsCodeApi();
const root = document.getElementById("root");
if (root) createRoot(root).render(<App post={(m) => api.postMessage(m)} />);
declare function acquireVsCodeApi(): { postMessage(m: unknown): void; setState(s: unknown): void; getState(): unknown };
