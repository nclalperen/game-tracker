import { useEffect } from "react";

interface Props {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export default function RightDrawer({ title, open, onClose, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!open) return null;
  return (
    <div className="drawer">
      <div className="drawer-header">
        <div className="drawer-title">{title}</div>
        <button className="btn-ghost" onClick={onClose}>Close</button>
      </div>
      <div className="drawer-body">{children}</div>
    </div>
  );
}
