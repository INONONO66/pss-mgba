import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ViewerStoreProvider } from "./store/ViewerStore";
import "./app.css";
import "./theme.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ViewerStoreProvider>
      <App />
    </ViewerStoreProvider>
  </React.StrictMode>
);
