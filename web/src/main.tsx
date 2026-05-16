import React from "react";
import ReactDOM from "react-dom/client";

import "@/styles/globals.css";
import { App } from "@/App";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container not found");
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
