import { useMemo } from "react";

export type Filters = {
  duration?: "short" | "medium" | "long" | "any";
  value?: "good" | "ok" | "poor" | "any";     // ₺/h
  score?: "80+" | "70+" | "any";
  platform?: string | "any";
  account?: string | "any";
  member?: string | "any";
  status?: string | "any";
  service?: string | "any";
};

type Opt = { label: string; value: string };

export default function FiltersBar({
  filters, setFilters,
  platforms, accounts, members, statuses, services
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  platforms: Opt[];
  accounts: Opt[];
  members: Opt[];
  statuses: Opt[];
  services: Opt[];
}) {
  const set = (k: keyof Filters) => (v: string) => setFilters({ ...filters, [k]: v as any });

  const Select = ({label, k, opts}: {label:string; k:keyof Filters; opts: Opt[]}) => (
    <label className="text-sm flex items-center gap-2">
      <span className="text-zinc-500 w-20">{label}</span>
      <select
        className="select"
        value={(filters[k] as string) ?? "any"}
        onChange={(e) => set(k)(e.target.value)}
      >
        {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );

  const durationOpts = useMemo<Opt[]>(() => [
    {label:"Any", value:"any"},
    {label:"≤10h", value:"short"},
    {label:"10–30h", value:"medium"},
    {label:"≥30h", value:"long"},
  ], []);
  const valueOpts: Opt[] = [
    {label:"Any", value:"any"},
    {label:"₺/h ≤ 10", value:"good"},
    {label:"₺/h ≤ 20", value:"ok"},
    {label:"₺/h > 20", value:"poor"},
  ];
  const scoreOpts: Opt[] = [
    {label:"Any", value:"any"},
    {label:"80+", value:"80+"},
    {label:"70+", value:"70+"},
  ];

  return (
    <div className="card flex flex-wrap gap-3 items-center">
      <Select label="Duration" k="duration" opts={durationOpts} />
      <Select label="Value"    k="value"    opts={valueOpts} />
      <Select label="Score"    k="score"    opts={scoreOpts} />
      <Select label="Platform" k="platform" opts={[{label:"Any",value:"any"}, ...platforms]} />
      <Select label="Account"  k="account"  opts={[{label:"Any",value:"any"}, ...accounts]} />
      <Select label="Member"   k="member"   opts={[{label:"Any",value:"any"}, ...members]} />
      <Select label="Status"   k="status"   opts={[{label:"Any",value:"any"}, ...statuses]} />
      <Select label="Service"  k="service"  opts={[{label:"Any",value:"any"}, ...services]} />
      <button className="btn-ghost ml-auto" onClick={() => setFilters({
        duration:"any", value:"any", score:"any",
        platform:"any", account:"any", member:"any", status:"any", service:"any"
      })}>Reset</button>
    </div>
  );
}
