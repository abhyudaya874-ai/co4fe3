import { createRoot } from "react-dom/client";
import { App, type Surface } from "./App.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import "./main.css";

// Mounts the chat and owns acquireVsCodeApi() (the vscode-extension skill: once, here).
declare function acquireVsCodeApi(): { postMessage(m: unknown): void; setState(s: unknown): void; getState(): unknown };
const api = acquireVsCodeApi();
const post = (m: unknown): void => api.postMessage(m);
const surface: Surface = document.body.dataset.surface === "agent" ? "agent" : "dock";
const root = document.getElementById("root");
if (root) createRoot(root).render(<ErrorBoundary scope="app"><App post={post} surface={surface} /></ErrorBoundary>);
