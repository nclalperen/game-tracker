import { useEffect, useMemo, useState } from "react";
import {
  db,
  getReonboardingSnooze,
  recentSessions,
  setReonboardingSnooze,
  type SessionEntry,
} from "@/db";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const REONBOARD_INTERVAL_MS = 7 * ONE_DAY_MS;

type ReOnboardingProps = {
  onStartPlan?: (identityId?: string | null) => void;
};

type ReOnboardingState = {
  ready: boolean;
  visible: boolean;
  session: SessionEntry | null;
  identityTitle: string | null;
};

const INITIAL_STATE: ReOnboardingState = {
  ready: false,
  visible: false,
  session: null,
  identityTitle: null,
};

export default function ReOnboarding({ onStartPlan }: ReOnboardingProps) {
  const [state, setState] = useState<ReOnboardingState>(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [session] = await recentSessions(1);
        if (!session || !session.endedAt) {
          if (!cancelled) setState({ ...INITIAL_STATE, ready: true });
          return;
        }

        const endedAtMs = Date.parse(session.endedAt);
        if (!Number.isFinite(endedAtMs)) {
          if (!cancelled) setState({ ...INITIAL_STATE, ready: true });
          return;
        }

        const snoozeIso = await getReonboardingSnooze();
        if (snoozeIso && Date.parse(snoozeIso) > Date.now()) {
          if (!cancelled) setState({ ...INITIAL_STATE, ready: true });
          return;
        }

        const elapsed = Date.now() - endedAtMs;
        if (elapsed < REONBOARD_INTERVAL_MS) {
          if (!cancelled) setState({ ...INITIAL_STATE, ready: true });
          return;
        }

        let identityTitle: string | null = null;
        if (session.identityId) {
          const identity = await db.identities.get(session.identityId);
          identityTitle = identity?.title ?? null;
        }

        if (!cancelled) {
          setState({ ready: true, visible: true, session, identityTitle });
        }
      } catch (err) {
        console.error("ReOnboarding load failed", err);
        if (!cancelled) setState({ ...INITIAL_STATE, ready: true });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const { visible, session, identityTitle } = state;
  const endedAt = useMemo(() => (session?.endedAt ? new Date(session.endedAt) : null), [session?.endedAt]);

  if (!visible || !session) {
    return null;
  }

  const lastPlayedLabel = identityTitle ?? session.exe;
  const daysAway = endedAt ? Math.floor((Date.now() - endedAt.getTime()) / ONE_DAY_MS) : null;

  const dismiss = async () => {
    const snoozeUntil = new Date(Date.now() + REONBOARD_INTERVAL_MS).toISOString();
    await setReonboardingSnooze(snoozeUntil);
    setState((prev) => ({ ...prev, visible: false }));
  };

  const startPlan = () => {
    onStartPlan?.(session.identityId ?? null);
  };

  return (
    <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-500">Welcome back</p>
          <h2 className="text-xl font-semibold text-emerald-900">It's been a while!</h2>
          <p className="text-sm text-emerald-700">
            {daysAway != null && daysAway > 0
              ? `You last played ${lastPlayedLabel} about ${daysAway} day${daysAway === 1 ? "" : "s"} ago.`
              : `You last played ${lastPlayedLabel}.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            onClick={startPlan}
          >
            Start mini plan
          </button>
          <button
            type="button"
            className="rounded-full border border-emerald-300 px-4 py-2 text-sm font-medium text-emerald-600 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            onClick={dismiss}
          >
            Dismiss
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-emerald-200 bg-white/90 p-4 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Where you stopped</h3>
          <p className="mt-2 text-sm font-medium text-emerald-900">{lastPlayedLabel}</p>
          <p className="text-xs text-emerald-600">{endedAt ? endedAt.toLocaleString() : "Unknown time"}</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-white/90 p-4 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Last note</h3>
          <p className="mt-2 text-sm text-emerald-700">No notes captured yet.</p>
        </div>
        <div className="rounded-2xl border border-dashed border-emerald-200 bg-white/60 p-4 text-center text-sm text-emerald-500">
          Screenshot recap coming soon.
        </div>
      </div>
    </div>
  );
}
