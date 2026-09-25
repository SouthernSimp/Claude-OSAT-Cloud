import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/components.css";
import "./styles/views.css";
import "./styles/today.css";
import "./styles/calendar.css";
import "./styles/notes.css";
import "./styles/board.css";
import "./styles/field.css";
import "./styles/home.css";
import "./styles/tools.css";
import "./styles/overlay.css";

// The Mac app draws its own title bar: leave room for the window buttons.
if (window.osatApp) document.documentElement.classList.add("is-mac-app");

let storedTheme = "system";
try { storedTheme = localStorage.getItem("osat.theme") || "system"; } catch { /* first paint only */ }
document.documentElement.dataset.theme = storedTheme === "system"
  ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  : storedTheme;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
