import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./index.css";
import App from "./ui/App";
import RouteErrorBoundary from "./ui/ErrorBoundary";
import LibraryPage from "./pages/LibraryPage";
import SuggestionsPage from "./pages/SuggestionsPage";
import ExplorePage from "./pages/ExplorePage";
import { hydrateVendorFlags } from "@/state/vendorFlags";

const SettingsPage = lazy(() => import("./pages/SettingsPage"));

void hydrateVendorFlags();

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <LibraryPage /> },
      { path: "explore", element: <ExplorePage /> },
      { path: "suggestions", element: <SuggestionsPage /> },
      {
        path: "settings",
        element: (
          <Suspense fallback={<div className="p-4 text-sm text-zinc-500">Loading settings...</div>}>
            <SettingsPage />
          </Suspense>
        ),
      },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
