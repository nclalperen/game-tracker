import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./index.css";
import App from "./ui/App";
import LibraryPage from "./pages/LibraryPage";
import SuggestionsPage from "./pages/SuggestionsPage";
import SettingsPage from "./pages/SettingsPage"; // <-- add this

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <LibraryPage /> },
      { path: "suggestions", element: <SuggestionsPage /> },
      { path: "settings", element: <SettingsPage /> }, // <-- add this
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
