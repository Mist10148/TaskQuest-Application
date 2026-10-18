import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// A deploy replaces the hashed page chunks, so a tab left open across one fails to load the next page. Reload once to
// pick up the new build (the flag stops a reload loop if the failure is something else).
window.addEventListener("vite:preloadError", (event) => {
  try {
    if (sessionStorage.getItem("tq.preload-reload")) return;
    sessionStorage.setItem("tq.preload-reload", "1");
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(<App />);
