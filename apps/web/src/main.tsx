import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// A deploy replaces the hashed page chunks, so a tab left open across one fails to load the next page. Reload once to
// pick up the new build. The time of that reload is kept so a failure that a reload does not fix cannot loop, while a
// later deploy, long after, still gets its own reload in the same tab.
const RELOAD_KEY = "tq.preload-reload";
const RELOAD_GAP_MS = 60_000;
window.addEventListener("vite:preloadError", (event) => {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY));
    if (last && Date.now() - last < RELOAD_GAP_MS) return;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(<App />);
