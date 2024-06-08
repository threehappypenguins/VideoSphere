import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { MetadataContextProvider } from "./context/MetadataContext";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <MetadataContextProvider>
      <App />
    </MetadataContextProvider>
  </React.StrictMode>
);
