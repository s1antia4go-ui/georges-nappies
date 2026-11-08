import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Inter, bundled with the app (no external font requests), so text looks the same on every laptop.
import "@fontsource-variable/inter/wght.css";
// Brand typeface for the wordmark and headings.
import "@fontsource-variable/bricolage-grotesque/standard.css";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
