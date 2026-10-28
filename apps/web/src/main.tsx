import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import { initTheme } from "@/lib/theme";
import { initToken } from "@/lib/token";
import "@/index.css";

initTheme();
initToken();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
