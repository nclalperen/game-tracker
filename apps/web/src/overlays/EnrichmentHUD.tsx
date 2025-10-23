import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useEnrichmentRunner } from "@/state/enrichmentRunner";

function InitLine() {
  return <div className="gt-hud__init" />;
}

export default function EnrichmentHUD() {
  const { snapshot, pause, resume, cancel } = useEnrichmentRunner();
  const [container] = useState(() => document.createElement("div"));
  const [showCompleteToast, setShowCompleteToast] = useState(false);

  useEffect(() => {
    container.className = "gt-hud-root";
    document.body.appendChild(container);
    return () => {
      document.body.removeChild(container);
    };
  }, [container]);

  useEffect(() => {
    if (!snapshot.sessionId && snapshot.finished) {
      setShowCompleteToast(true);
      const timer = window.setTimeout(() => setShowCompleteToast(false), 4000);
      return () => window.clearTimeout(timer);
    }
    if (snapshot.sessionId) {
      setShowCompleteToast(false);
    }
    return;
  }, [snapshot.sessionId, snapshot.finished]);

  if (!snapshot.sessionId && !showCompleteToast) {
    return null;
  }

  const total = snapshot.totalRows || 0;
  const completed = snapshot.completedCount || 0;
  const pct = total > 0 ? Math.min(100, Math.max(6, (completed / total) * 100)) : 0;
  const isPaused = snapshot.paused;
  const latest = snapshot.recent[0];
  const title = snapshot.sessionId
    ? isPaused
      ? "Enrichment paused"
      : "Enriching library"
    : "Enrichment complete";
  const subtitle = snapshot.sessionId
    ? `${completed} / ${total} enriched`
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
      {line}

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
                onClick={() => cancel()}
                title="Cancel enrichment"
              >
                Cancel
              </button>
              <button
                type="button"
                className="gt-hud-card__btn"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("gt:show-enrichment"));
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

