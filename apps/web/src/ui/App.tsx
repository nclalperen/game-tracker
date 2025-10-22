import { useEffect } from "react";
import { Outlet, NavLink } from "react-router-dom";
import { ensureSeed } from "@/utils/seed";

export default function App() {
  useEffect(() => {
    ensureSeed();
  }, []);

  return (
    <div className="max-w-6xl mx-auto p-4">
      <nav className="flex gap-4 mb-4">
        <NavLink to="/" end>Library</NavLink>
        <NavLink to="/suggestions">Suggestions</NavLink>
        <NavLink to="/settings">Settings</NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
