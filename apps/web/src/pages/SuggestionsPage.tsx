import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { db, getSetting, setSetting, saveTranscript } from "@/db";

import { type LibraryItem, type Identity } from "@tracker/core";

import { isTauri } from "@/desktop/bridge";

import { rankWithAI, type AIRankedResponse } from "@/ally/aiClient";

import { buildCandidates } from "@/ally/buildCandidates";

import { getOrCreateSession } from "@/ally/session";

import { ChartsBlock } from "@/ally/Charts";

import { TranscriptPanel } from "@/ally/TranscriptPanel";



const AI_MODE_KEY = "suggest.aiMode";

const AI_ALLOW_WEB_KEY = "suggest.aiAllowWeb";

const AI_TIMEBOX_KEY = "suggest.aiTimebox";

const AI_QUERY_KEY = "suggest.aiQuery";

const AI_PENDING_KEY = "suggest.pendingAsk";

const AI_SAVE_TRANSCRIPTS_KEY = "ally.saveTranscripts";
const AI_STRICT_JSON_KEY = "suggest.strictJson";

type AskOverrides = {
  mode?: "coach" | "deals" | "qa";
  allowWeb?: boolean;
  timebox?: number | "-";
  mustTags?: string[];
  avoidTags?: string[];
  query?: string;
};

const waitForNextFrame = () =>
  new Promise<void>((resolve) => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => resolve());
    } else {
      setTimeout(() => resolve(), 0);
    }
  });

/** ---------- page ---------- */
export default function SuggestionsPage() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiMode, setAiMode] = useState<"coach" | "deals" | "qa">("coach");
  const [allowWeb, setAllowWeb] = useState(false);
  const [strictJson, setStrictJson] = useState(true);
  const [timebox, setTimebox] = useState<number | "-">("-");
  const [mustTags, setMustTags] = useState<string[]>([]);
  const [avoidTags, setAvoidTags] = useState<string[]>([]);
  const [aiQuery, setAiQuery] = useState("-");
  const [aiResponse, setAiResponse] = useState<AIRankedResponse | null>(null);
  const [aiWarningBanner, setAiWarningBanner] = useState<string | null>(null);
  const [aiProgress, setAiProgress] = useState<{ label: string; percent: number } | null>(null);
  const [saveTranscriptsEnabled, setSaveTranscriptsEnabled] = useState(true);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const desktop = isTauri;

  const showTranscriptPanel = import.meta.env.VITE_DEV_INSPECTOR === "1";



  // Load data once

  useEffect(() => {

    (async () => {

      const [lib, idents] = await Promise.all([

        db.library.toArray(),

        db.identities.toArray(),

      ]);

      setItems(lib);

      setIdentities(idents);

    })();

  }, []);



  useEffect(() => {

    if (typeof window === "undefined") return;

    if (window.location.hash === "#ai") {

      const anchor = document.getElementById("ai");

      if (anchor) {

        anchor.scrollIntoView({ behavior: "smooth", block: "start" });

      }

    }

  }, []);



  useEffect(() => {

    if (!desktop) return;

    getOrCreateSession();

  }, [desktop]);

  // Load Strict JSON preference
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await getSetting<boolean>(AI_STRICT_JSON_KEY);
        if (!cancelled && typeof v === "boolean") setStrictJson(v);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);



  useEffect(() => {

    if (!desktop) return;

    let cancelled = false;

    (async () => {

      try {

        const [savedMode, savedAllow, savedTimebox, savedQuery] = await Promise.all([

          getSetting<string>(AI_MODE_KEY),

          getSetting<boolean>(AI_ALLOW_WEB_KEY),

          getSetting<number>(AI_TIMEBOX_KEY),

          getSetting<string>(AI_QUERY_KEY),

        ]);

        if (cancelled) return;

        if (savedMode === "coach" || savedMode === "deals" || savedMode === "qa") {

          setAiMode(savedMode);

        }

        if (typeof savedAllow === "boolean") {

          setAllowWeb(savedAllow);

        }

        if (typeof savedTimebox === "number" && !Number.isNaN(savedTimebox)) {

          setTimebox(savedTimebox);

        }

        if (typeof savedQuery === "string") {

          setAiQuery(savedQuery);

        }

      } catch {

        // ignore rehydrate errors

      }

    })();

    return () => {

      cancelled = true;

    };

  }, [desktop]);



  useEffect(() => {

    const handler = (event: Event) => {

      const detail = (event as CustomEvent<boolean>).detail;

      setSaveTranscriptsEnabled(detail !== false);

    };

    window.addEventListener("ally:transcripts-toggle", handler as EventListener);

    return () => {

      window.removeEventListener("ally:transcripts-toggle", handler as EventListener);

    };

  }, []);



  useEffect(() => {

    if (!desktop) return;

    let cancelled = false;

    (async () => {

      try {

        const value = await getSetting<boolean>(AI_SAVE_TRANSCRIPTS_KEY);

        if (!cancelled) {

          setSaveTranscriptsEnabled(value !== false);

        }

      } catch {

        if (!cancelled) {

          setSaveTranscriptsEnabled(true);

        }

      }

    })();

    return () => {

      cancelled = true;

    };

  }, [desktop]);



  useEffect(() => {

    if (!desktop) return;

    const handle = window.setTimeout(() => {

      void setSetting(AI_MODE_KEY, aiMode);

    }, 300);

    return () => window.clearTimeout(handle);

  }, [desktop, aiMode]);



  useEffect(() => {

    if (!desktop) return;

    const handle = window.setTimeout(() => {

      void setSetting(AI_ALLOW_WEB_KEY, allowWeb);

    }, 300);

    return () => window.clearTimeout(handle);

  }, [desktop, allowWeb]);



  useEffect(() => {

    if (!desktop) return;

    const handle = window.setTimeout(() => {

      const value = typeof timebox === "number" ? timebox : null;

      void setSetting(AI_TIMEBOX_KEY, value);

    }, 300);

    return () => window.clearTimeout(handle);

  }, [desktop, timebox]);



  useEffect(() => {

    if (!desktop) return;

    const handle = window.setTimeout(() => {

      void setSetting(AI_QUERY_KEY, aiQuery);

    }, 300);

    return () => window.clearTimeout(handle);

  }, [desktop, aiQuery]);



  const idById = useMemo(

    () => new Map(identities.map((i) => [i.id, i] as const)),

    [identities]

  );



  const suggestions = useMemo(

    () =>

      items.map((item) => ({

        id: item.id,

        item,

      })),

    [items],

  );



  const suggestionById = useMemo(

    () => new Map(suggestions.map((s) => [s.id, s] as const)),

    [suggestions]

  );



  const parseTagList = (value: string) =>

    value

      .split(",")

      .map((tag) => tag.trim())

      .filter(Boolean);



  const applyOverrides = useCallback((preset: AskOverrides) => {

    if (preset.mode) setAiMode(preset.mode);

    if (preset.allowWeb !== undefined) setAllowWeb(preset.allowWeb);

    if (preset.timebox !== undefined) {

      const timeboxValue = preset.timebox;

      if (timeboxValue === "-" || timeboxValue == null) {

        setTimebox("-");

      } else if (typeof timeboxValue === "number" && Number.isNaN(timeboxValue)) {

        setTimebox("-");

      } else {

        setTimebox(timeboxValue);

      }

    }

    if (preset.mustTags !== undefined) setMustTags(preset.mustTags);

    if (preset.avoidTags !== undefined) setAvoidTags(preset.avoidTags);

    if (preset.query !== undefined) setAiQuery(preset.query);

  }, []);



  const onAsk = useCallback(
    async (override?: AskOverrides) => {
      if (!desktop) {
        setAiError("AI suggestions require the desktop sidecar.");
        return;
      }

      const mode = override?.mode ?? aiMode;
      const allow = override?.allowWeb ?? allowWeb;
      const finalTimebox = override?.timebox ?? timebox;
      const finalMust = override?.mustTags ?? mustTags;
      const finalAvoid = override?.avoidTags ?? avoidTags;
      const queryText = (override?.query ?? aiQuery).trim() || "Recommend what to play next.";
      let session: string | null = null;

      try {
        setAiBusy(true);
        setAiError(null);
        setAiResponse(null);
        setAiWarningBanner(null);
        setAiProgress({ label: "Collecting library data...", percent: 10 });
        await waitForNextFrame();

        const baseRows = suggestions.map((s) => {
          const ident = idById.get(s.item.identityId);
          const criticScore =
            ident?.criticScoreSource === "metacritic"
              ? ident?.mcScore ?? s.item.mcScore ?? s.item.ocScore ?? null
              : ident?.criticScoreSource === "opencritic"
              ? ident?.ocScore ?? s.item.ocScore ?? s.item.mcScore ?? null
              : ident?.ocScore ?? ident?.mcScore ?? s.item.ocScore ?? s.item.mcScore ?? null;
          return {
            id: s.id,
            identityId: s.item.identityId,
            title: ident?.title ?? s.item.identityId,
            appid: ident?.appid,
            installed: !!s.item.installed,
            platform: ident?.platform,
            ttb: { main: ident?.ttbMedianMainH ?? s.item.ttbMedianMainH ?? null },
            ttbMainH: ident?.ttbMedianMainH ?? s.item.ttbMedianMainH ?? null,
            criticScore,
            price: s.item.priceTRY ?? null,
            currencyCode: s.item.currencyCode ?? null,
            tags: ident?.mcGenres ?? [],
            services: s.item.services ?? [],
            status: s.item.status,
            playtimeForeverMin: s.item.playtimeForeverMin ?? null,
            lastPlayedAtISO: s.item.lastPlayedAtISO ?? null,
          };
        });
        setAiProgress({
          label: mode === "deals" ? "Gathering active deals..." : "Scoring candidate features...",
          percent: 35,
        });
        await waitForNextFrame();

        const allCandidates = await buildCandidates(mode, baseRows);
        const candidates = allCandidates.slice(0, 100);

        setAiProgress({
          label: mode === "deals" ? "Preparing deal prompt..." : "Preparing prompt for Ally...",
          percent: 55,
        });
        await waitForNextFrame();

        session = getOrCreateSession();

        setAiProgress({ label: "Asking Ally for suggestions...", percent: 75 });
        await waitForNextFrame();

        const reply = await rankWithAI(
          queryText,
          candidates,
          {
            allowWeb: allow,
            mode,
            timeboxMin: typeof finalTimebox === "number" ? finalTimebox : null,
            mustTags: finalMust,
            avoidTags: finalAvoid,
            strictJson,
          },
          session,
          allCandidates,
        );
        setAiProgress({ label: "Processing Ally's reply...", percent: 90 });

        setAiResponse(reply);
        setAiWarningBanner(reply.warning ?? null);
        setInsightsOpen(false);

        if (saveTranscriptsEnabled) {
          try {
            await saveTranscript({
              atISO: new Date().toISOString(),
              session,
              mode,
              allowWeb: allow,
              query: queryText,
              reply: reply.parsed ?? reply.rawText,
              rawText: reply.rawText,
              warning: reply.warning ?? null,
              parseError: reply.parsed ? null : reply.warning ?? "Reply failed validation.",
            });
          } catch (err) {
            console.warn("Failed to save transcript", err);
          }
        }

        setAiProgress({ label: "Finishing up...", percent: 100 });
      } catch (e: any) {
        const message = String(e?.message || e);
        setAiError(message);
        if (saveTranscriptsEnabled) {
          try {
            await saveTranscript({
              atISO: new Date().toISOString(),
              session,
              mode,
              allowWeb: allow,
              query: queryText,
              reply: { error: message },
              warning: "AI request failed before completion.",
              parseError: message,
            });
          } catch (err) {
            console.warn("Failed to save transcript after error", err);
          }
        }
      } finally {
        setAiBusy(false);
        setAiProgress(null);
      }
    },
    [
      desktop,
      aiMode,
      allowWeb,
      timebox,
      mustTags,
      avoidTags,
      aiQuery,
      suggestions,
      idById,
      saveTranscriptsEnabled,
    ],
  );



  const presetAsk = useCallback(

    (preset: AskOverrides) => {

      applyOverrides(preset);

      void onAsk(preset);

    },

    [applyOverrides, onAsk]

  );



  useEffect(() => {

    if (!desktop) return;

    try {

      const raw = sessionStorage.getItem(AI_PENDING_KEY);

      if (!raw) return;

      sessionStorage.removeItem(AI_PENDING_KEY);

      const payload = JSON.parse(raw) as AskOverrides;

      applyOverrides(payload);

      void onAsk(payload);

    } catch {

      // ignore invalid payload

    }

  }, [desktop, applyOverrides, onAsk]);



  const mustTagsInput = mustTags.join(", ");

  const avoidTagsInput = avoidTags.join(", ");



  const onMustTagsChange = (value: string) => setMustTags(parseTagList(value));

  const onAvoidTagsChange = (value: string) => setAvoidTags(parseTagList(value));



  const onAskClick = useCallback(() => {

    void onAsk();

  }, [onAsk]);



  const autoAskedRef = useRef(false);

  useEffect(() => {

    if (!desktop) return;

    if (autoAskedRef.current) return;

    if (items.length === 0) return;

    autoAskedRef.current = true;

    void onAsk();

  }, [desktop, items.length, onAsk]);



  const progressPercent = Math.round(
    Math.min(100, Math.max(aiProgress?.percent ?? 0, aiBusy ? 5 : 0)),
  );

  return (

    <div className="space-y-4">

      {desktop ? (

        <section id="ai" className="card space-y-3">

          <div className="flex flex-wrap items-start justify-between gap-3">

            <div>

              <h2 className="text-lg font-semibold">AI Suggestions</h2>

              <p className="text-xs text-zinc-500">

                Ally reviews your library, wishlist, and play history to surface the smartest next steps.

              </p>

            </div>

            <div className="flex items-center gap-3">

              <label className="flex items-center gap-2 text-sm text-zinc-600">

                <input

                  type="checkbox"

                  checked={allowWeb}

                  onChange={(event) => setAllowWeb(event.target.checked)}

                />

                Allow web fallback

              </label>

              <label className="flex items-center gap-2 text-sm text-zinc-600">

                <input

                  type="checkbox"

                  checked={strictJson}

                  onChange={(event) => {
                    const v = event.target.checked;
                    setStrictJson(v);
                    void setSetting(AI_STRICT_JSON_KEY, v);
                  }}

                />

                Strict JSON (fewer fallbacks)

              </label>

              <button

                type="button"

                className="btn"

                onClick={onAskClick}

                disabled={aiBusy}

              >

                {aiBusy ? "Asking..." : "Ask AI"}

              </button>

            </div>

          </div>



          <div className="flex flex-wrap gap-2">

            <button

              type="button"

              className="badge cursor-pointer"

              onClick={() =>

                presetAsk({

                  mode: "coach",

                  timebox: 30,

                  mustTags: [],

                  avoidTags: [],

                  query: "Suggest 3 games I own under 30 minutes.",

                })

              }

            >

              Under 30 min

            </button>

            <button

              type="button"

              className="badge cursor-pointer"

              onClick={() =>

                presetAsk({

                  mode: "coach",

                  mustTags: ["Story Rich", "Narrative"],

                  avoidTags: [],

                  query: "Pick story-driven games I can finish soon.",

                })

              }

            >

              Short narrative

            </button>

            <button

              type="button"

              className="badge cursor-pointer"

              onClick={() =>

                presetAsk({

                  mode: "coach",

                  mustTags: ["Co-op", "Local Co-Op"],

                  avoidTags: [],

                  query: "Find co-op games to play tonight.",

                })

              }

            >

              Co-op tonight

            </button>

            <button

              type="button"

              className="badge cursor-pointer"

              onClick={() =>

                presetAsk({

                  mode: "coach",

                  query: "Plan to finish one ongoing game in 3 sessions.",

                })

              }

            >

              Finish in 3 sessions

            </button>

            <button

              type="button"

              className="badge cursor-pointer"

              onClick={() =>

                presetAsk({

                  mode: "deals",

                  query: "Which wishlist or owned games have >50% discount?",

                })

              }

            >

              Deals &gt; 50%

            </button>

          </div>



          <div className="grid gap-3 md:grid-cols-2">

            <label className="flex flex-col gap-1 text-sm">

              <span className="font-medium text-zinc-600">Mode</span>

              <select

                className="input"

                value={aiMode}

                onChange={(event) => setAiMode(event.target.value as typeof aiMode)}

              >

                <option value="coach">Coach (Play next)</option>

                <option value="deals">Deals &amp; claims</option>

                <option value="qa">Free-form Q&amp;A</option>

              </select>

            </label>

            <label className="flex flex-col gap-1 text-sm">

              <span className="font-medium text-zinc-600">Timebox (minutes)</span>

              <input

                type="number"

                min={0}

                className="input"

                value={timebox === "-" ? "-" : timebox}

                onChange={(event) => {

                  const raw = event.target.value;

                  if (raw === "-") {

                    setTimebox("-");

                    return;

                  }

                  const parsed = Number(raw);

                  setTimebox(Number.isNaN(parsed) ? "-" : parsed);

                }}

              />

            </label>

            <label className="flex flex-col gap-1 text-sm">

              <span className="font-medium text-zinc-600">Must include tags</span>

              <input

                type="text"

                className="input"

                placeholder="Comma separated tags"

                value={mustTagsInput}

                onChange={(event) => onMustTagsChange(event.target.value)}

              />

            </label>

            <label className="flex flex-col gap-1 text-sm">

              <span className="font-medium text-zinc-600">Avoid tags</span>

              <input

                type="text"

                className="input"

                placeholder="Comma separated tags"

                value={avoidTagsInput}

                onChange={(event) => onAvoidTagsChange(event.target.value)}

              />

            </label>

          </div>



          <label className="flex flex-col gap-1 text-sm">

            <span className="font-medium text-zinc-600">Custom query</span>

            <textarea

              className="input min-h-[80px]"

              value={aiQuery}

              onChange={(event) => setAiQuery(event.target.value)}

              placeholder="Ask Ally for tailored suggestions…"

            />

          </label>



          {aiError && (

            <div className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">

              <div className="font-medium">AI request failed.</div>

              <details className="mt-2 text-xs">

                <summary className="cursor-pointer text-rose-600 underline">

                  Details

                </summary>

                <pre className="mt-1 whitespace-pre-wrap break-words">{aiError}</pre>

              </details>

            </div>

          )}

        </section>

      ) : (

        <section className="card bg-zinc-50 text-sm text-zinc-600">

          AI requires desktop sidecar.

        </section>

      )}



      {(aiBusy || aiProgress) && (

        <section className="card space-y-3" role="status" aria-live="polite">

          <div className="flex items-center justify-between text-sm font-medium text-zinc-700 dark:text-zinc-200">

            <span>Working on suggestions…</span>

            <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">{`${progressPercent}%`}</span>

          </div>

          <div

            className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"

            role="progressbar"

            aria-label="Suggestions progress"

            aria-valuemin={0}

            aria-valuemax={100}

            aria-valuenow={progressPercent}

          >

            <div

              className="h-full rounded-full bg-emerald-500 transition-[width] duration-300 ease-out"

              style={{ width: `${progressPercent}%` }}

            />

          </div>

          <div className="text-xs text-zinc-500 dark:text-zinc-400">

            {aiProgress?.label ?? "Preparing request…"}

          </div>

        </section>

      )}



      {desktop && aiResponse && !aiBusy && (

        <section className="space-y-2">

          <h3 className="text-sm font-semibold text-zinc-700">

            AI-ranked Suggestions

          </h3>

          {aiWarningBanner ? (

            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">

              {aiWarningBanner}

            </div>

          ) : null}


          {aiResponse.parsed == null ? (
            <details className="rounded border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
              <summary className="cursor-pointer font-semibold text-zinc-700">
                View Ally response
              </summary>
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-zinc-900/90 p-3 font-mono text-[11px] text-emerald-200 dark:bg-black/70">
                {aiResponse.rawText}
              </pre>
            </details>
          ) : null}

          {aiResponse.notes ? (


            <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">

              {aiResponse.notes}

            </div>

          ) : null}

          <div className="space-y-3">

            {aiResponse.results.length === 0 && (

              <div className="card text-sm text-zinc-500">

                Ally didn't return any matches for that prompt. Try adjusting the filters.

              </div>

            )}

            {aiResponse.results.map((res) => {

              const suggestion = suggestionById.get(res.id);

              const ident = suggestion ? idById.get(suggestion.item.identityId) : undefined;

              const title = ident?.title || suggestion?.item.identityId || res.id;

              const platform = ident?.platform ?? "-";

              return (
                <article key={res.id} className="card flex items-start gap-4">
                  <div className="flex min-w-[3.5rem] flex-col items-center gap-1">
                    <span className="text-xl font-semibold text-zinc-700">
                      #{res.rank}
                    </span>
                    <span className="badge" title={res.reason || "AI suggestion"}>
                      AI
                    </span>
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-medium">{title}</div>
                      <span className="badge">{platform}</span>
                    </div>
                    {res.reason ? (
                      <p className="text-sm text-zinc-600">{res.reason}</p>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>

          {aiResponse.charts && aiResponse.charts.length > 0 ? (

            <details

              className="rounded border border-zinc-200 bg-zinc-50 p-3"

              open={insightsOpen}

              onToggle={(event) => setInsightsOpen(event.currentTarget.open)}

            >

              <summary className="cursor-pointer text-sm font-semibold text-zinc-700">

                View insights

              </summary>

              <ChartsBlock charts={aiResponse.charts} />

            </details>

          ) : null}

        </section>

      )}



      {!aiBusy && aiResponse == null && desktop ? (

        <section className="card text-sm text-zinc-500">

          Ask Ally above to generate fresh suggestions. Try one of the presets or craft your own prompt.

        </section>

      ) : null}



      {showTranscriptPanel ? <TranscriptPanel enabled={showTranscriptPanel} /> : null}

    </div>

  );

}



/** ---------- small UI bits ---------- */




