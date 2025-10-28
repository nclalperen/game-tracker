import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEnrichmentRunner } from "@/state/enrichmentRunner";

function InitLine() {
  return <div className="gt-hud__init" />;
}

export default function EnrichmentHUD() {
  const { snapshot, pause, resume, halt } = useEnrichmentRunner();
  const [container] = useState(() => document.createElement("div"));
  const [showCompleteToast, setShowCompleteToast] = useState(false);
  const [visible, setVisible] = useState(true);
  const prevSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    container.className = "gt-hud-root";
    document.body.appendChild(container);
    return () => {
      document.body.removeChild(container);
    };
  }, [container]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const show = () => setVisible(true);
    const hide = () => setVisible(false);
    window.addEventListener("gt:show-enrichment", show);
    window.addEventListener("gt:hide-enrichment", hide);
    return () => {
      window.removeEventListener("gt:show-enrichment", show);
      window.removeEventListener("gt:hide-enrichment", hide);
    };
  }, []);

  useEffect(() => {
    if (!snapshot.sessionId && snapshot.finished) {
      setShowCompleteToast(true);
      const timer = window.setTimeout(() => setShowCompleteToast(false), 4000);
      return () => window.clearTimeout(timer);
    }
    if (snapshot.sessionId) {
      setShowCompleteToast(false);
    }
  }, [snapshot.sessionId, snapshot.finished]);

  useEffect(() => {
    const current = snapshot.sessionId ?? null;
    const prev = prevSessionIdRef.current;
    if (current && current !== prev) {
      setVisible(!snapshot.halted);
    }
    prevSessionIdRef.current = current;
  }, [snapshot.sessionId, snapshot.halted]);

  useEffect(() => {
    if (snapshot.halted) {
      setVisible(false);
    }
  }, [snapshot.halted]);

  const hasSession = Boolean(snapshot.sessionId);

  if (!hasSession && !showCompleteToast) {
    return null;
  }

  if (hasSession && !visible) {
    return null;
  }

  const total = snapshot.totalRows || 0;
  const completed = snapshot.completedCount || 0;
  const pct = total > 0 ? Math.min(100, Math.max(6, (completed / total) * 100)) : 0;
  const isPaused = snapshot.paused;
  const isHalted = snapshot.halted;
  const latest = snapshot.recent[0];
  const title = snapshot.sessionId
    ? isPaused
      ? isHalted
        ? "Enrichment halted"
        : "Enrichment paused"
      : "Enriching library"
    : "Enrichment complete";
  const subtitle = snapshot.sessionId
    ? isHalted
      ? `Halted - ${completed} / ${total} enriched`
      : `${completed} / ${total} enriched`
    : "Metadata enrichment finished";

  const line =
    snapshot.phase === "init" ? (
      <div
        className="gt-hud"
        role="progressbar"
        aria-label="Import enrichment progress"
        aria-valuemin={0}
        aria-valuemax={Math.max(total, 1)}
        aria-valuenow={completed}
        aria-valuetext="Initializing..."
        aria-live="polite"
      >
        <InitLine />
      </div>
    ) : (
      <div
        className="gt-hud"
        role="progressbar"
        aria-label="Import enrichment progress"
        aria-valuemin={0}
        aria-valuemax={Math.max(total, 1)}
        aria-valuenow={completed}
      >
        <div className="gt-hud__prog" style={{ width: `${pct}%` }} />
      </div>
    );

  return createPortal(
    <>
      {hasSession ? line : null}

      <div
        className="gt-hud-card"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="gt-hud-card__header">
          <span className="gt-hud-card__title">{title}</span>
          {snapshot.sessionId && (
            <div className="gt-hud-card__actions">
              <button
                type="button"
                className="gt-hud-card__btn"
                onClick={() => (isPaused ? resume() : pause())}
                aria-pressed={isPaused}
                title={isPaused ? "Resume enrichment" : "Pause enrichment"}
              >
                {isPaused ? "Resume" : "Pause"}
              </button>
              <button
                type="button"
                className="gt-hud-card__btn"
                onClick={() => {
                  halt();
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("gt:hide-enrichment"));
                  }
                }}
                title="Halt enrichment (resume later from Settings)"
              >
                Halt
              </button>
              <button
                type="button"
                className="gt-hud-card__btn"
                onClick={() => {
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("gt:show-enrichment"));
                  }
                }}
                title="Show enrichment details"
              >
                Show
              </button>
            </div>
          )}
        </div>
        <div className="gt-hud-card__subtitle">{subtitle}</div>
        {latest ? (
          <div className="gt-hud-card__latest">
            Latest: <strong>{latest.title}</strong>
            {latest.price != null && latest.currencyCode
              ? ` - ${latest.currencyCode} ${latest.price}`
              : null}
            {latest.ttb != null ? ` - TTB ${latest.ttb}h` : null}
            {latest.ocScore != null ? ` - OC ${latest.ocScore}` : null}
          </div>
        ) : (
          <div className="gt-hud-card__latest">Waiting for next item...</div>
        )}
      </div>
    </>,
    container,
  );
}
