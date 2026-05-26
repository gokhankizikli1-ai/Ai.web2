/**
 * AdminPanel — owner-only overlay with developer tooling tabs.
 *
 * Tabs:
 *   - Overview     model routing, providers, deployment, flags
 *   - Agents       hidden / internal agents catalogue
 *   - Memory       project memory inspector
 *   - Tools        tool-call history
 *   - Prompts      system-prompt versions
 *   - Audit        admin action log
 *   - Owner Agent  chat with the private Shadow Agent
 *
 * Every tab fetches from /v2/admin/* with the same Authorization header
 * pattern as useOwnerMode. Errors degrade to "data unavailable" — the
 * panel never throws.
 */
import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  X, ShieldCheck, Activity, Bot, Database, Wrench,
  FileCode, ClipboardList, MessageSquare, Loader2, AlertTriangle,
  Zap,
} from 'lucide-react';
import type { OwnerModeState, OrchestrationCapability } from '@/hooks/useOwnerMode';
import { ORCHESTRATION_CAPABILITY_IDS } from '@/hooks/useOwnerMode';

const DEFAULT_API_HOST = 'https://korvixai-backend-production.up.railway.app';
const API_BASE = `${
  (import.meta.env?.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  DEFAULT_API_HOST
}`;

type TabId =
  | 'overview' | 'session' | 'agents' | 'memory' | 'tools'
  | 'prompts' | 'audit' | 'owner-agent';

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview',     label: 'Overview',     icon: Activity },
  { id: 'session',      label: 'Owner Session', icon: Zap },
  { id: 'agents',       label: 'Agents',       icon: Bot },
  { id: 'memory',       label: 'Memory',       icon: Database },
  { id: 'tools',        label: 'Tools',        icon: Wrench },
  { id: 'prompts',      label: 'Prompts',      icon: FileCode },
  { id: 'audit',        label: 'Audit',        icon: ClipboardList },
  { id: 'owner-agent',  label: 'Owner Agent',  icon: MessageSquare },
];

interface AdminPanelProps {
  ownerMode: OwnerModeState;
  onClose: () => void;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const t = localStorage.getItem('korvix_access_token');
    if (t) headers['Authorization'] = `Bearer ${t}`;
    const ot = localStorage.getItem('korvix_owner_token');
    if (ot) headers['X-Korvix-Owner-Token'] = ot;
    const g = localStorage.getItem('korvix_user_id');
    if (g) headers['X-Korvix-Guest-Id'] = g;
  } catch { /* ignore */ }
  return headers;
}

async function fetchAdmin<T = unknown>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
    if (!r.ok) return null;
    const body = await r.json();
    return (body?.data ?? null) as T | null;
  } catch {
    return null;
  }
}

export default function AdminPanel({ ownerMode, onClose }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  // ESC key + body-scroll-lock + back-button safety. Three small behaviours
  // grouped here because each addresses a way users got stuck on
  // mobile/iPad:
  //   - ESC: keyboard / external keyboard users
  //   - touchmove on backdrop is not consumed by stopPropagation in
  //     the inner div, so the page underneath could scroll OR the
  //     modal could feel "trapped". Locking body scroll while open
  //     fixes both directions.
  //   - On iOS, an active modal that doesn't preserve scroll
  //     position causes the URL bar to collapse, hiding the close
  //     button. Restoring overflow on unmount fixes that on close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      // Tap-anywhere-outside closes. The inner card's
      // stopPropagation keeps clicks inside from triggering it.
      className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-md flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
      role="presentation"
      data-testid="admin-panel-overlay"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1,    y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        // Responsive sizing:
        //   - dvh (dynamic viewport height) accounts for iOS Safari's
        //     collapsing URL bar — h-[80vh] left the bottom of the
        //     panel under the URL bar at certain scroll positions
        //   - On <md viewports the tabs nav collapses to a top scroll
        //     bar instead of a left column, so the content area is
        //     usable on narrow widths
        className="relative w-full max-w-5xl h-[92dvh] sm:h-[88dvh] md:h-[85dvh] rounded-2xl border border-amber-500/20 bg-[#0b0b12]/95 shadow-2xl shadow-amber-500/5 overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="Owner panel"
        data-testid="admin-panel-card"
      >
        {/* Header — close button always reachable (sticky to top, larger
            tap target on touch devices). */}
        <div className="shrink-0 flex items-center justify-between px-4 sm:px-5 py-3 sm:py-3.5 border-b border-white/[0.05] bg-gradient-to-r from-amber-500/[0.04] to-transparent">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-7 w-7 flex items-center justify-center rounded-lg bg-amber-500/[0.1] border border-amber-500/20 shrink-0">
              <ShieldCheck className="h-3.5 w-3.5 text-amber-300" />
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-white tracking-tight truncate">Owner Panel</div>
              <div className="text-[10px] text-amber-300/60 truncate">
                {ownerMode.capabilities.length} capabilities unlocked
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            // 44×44px touch target on mobile, smaller on desktop —
            // matches Apple HIG / WCAG 2.5.5 minimum touch target.
            className="h-11 w-11 sm:h-8 sm:w-8 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-white/[0.05] active:bg-white/[0.08] transition-all shrink-0"
            aria-label="Close owner panel"
            data-testid="admin-panel-close"
          >
            <X className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
          </button>
        </div>

        {/* Body — tabs+content. Stacks vertically on small viewports
            (tabs become a horizontal scroll strip across the top). */}
        <div className="flex flex-1 min-h-0 flex-col md:flex-row">
          {/* Tabs */}
          <nav
            className="shrink-0 border-b md:border-b-0 md:border-r border-white/[0.04] p-2 md:w-44 overflow-x-auto md:overflow-x-visible md:overflow-y-auto scrollbar-none"
            data-testid="admin-panel-tabs"
          >
            <div className="flex md:flex-col gap-0.5">
              {TABS.map((t) => {
                const Icon = t.icon;
                const active = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id)}
                    className={`shrink-0 md:w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] transition-all whitespace-nowrap ${
                      active
                        ? 'bg-amber-500/[0.08] text-amber-200 border border-amber-500/15'
                        : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.03] border border-transparent'
                    }`}
                  >
                    <Icon className="h-3 w-3" />
                    <span className="md:flex-1 md:text-left">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Tab content */}
          <div className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-5 text-[12px] text-slate-300 [-webkit-overflow-scrolling:touch]">
            {activeTab === 'overview'    && <OverviewTab />}
            {activeTab === 'session'     && <SessionTab ownerMode={ownerMode} />}
            {activeTab === 'agents'      && <AgentsTab />}
            {activeTab === 'memory'      && <MemoryTab />}
            {activeTab === 'tools'       && <ToolsTab />}
            {activeTab === 'prompts'     && <PromptsTab />}
            {activeTab === 'audit'       && <AuditTab />}
            {activeTab === 'owner-agent' && <OwnerAgentTab />}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ─── Helpers ─────────────────────────────────────────────────────────── */

function Empty({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-slate-600">
      <AlertTriangle className="h-4 w-4 mb-2 text-amber-500/40" />
      <span className="text-[11px]">{message}</span>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 text-slate-600 text-[11px] py-4">
      <Loader2 className="h-3 w-3 animate-spin" />
      Loading…
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">{title}</h3>
      {children}
    </section>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1 border-b border-white/[0.03]">
      <span className="text-slate-500 text-[11px] w-40 shrink-0">{k}</span>
      <span className="text-slate-200 text-[11px] font-mono break-all">{v}</span>
    </div>
  );
}

/* ─── Tabs ─────────────────────────────────────────────────────────────── */

interface Diagnostics {
  service: string;
  environment: string;
  python_version: string;
  platform: string;
  models: Record<string, string>;
  providers: Array<{ name: string; registered: boolean; default_model?: string }>;
  routing: { modes?: Array<{ mode: string; provider: string }>; default_provider?: string };
  background_tasks: Record<string, unknown>;
  flags: Record<string, boolean>;
  deployment: Record<string, string>;
}

function OverviewTab() {
  const [d, setD] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetchAdmin<Diagnostics>('/v2/admin/diagnostics').then((res) => {
      setD(res);
      setLoading(false);
    });
  }, []);
  if (loading) return <Loading />;
  if (!d) return <Empty message="Diagnostics unavailable." />;
  return (
    <div>
      <Section title="Service">
        <KV k="service"     v={d.service} />
        <KV k="environment" v={d.environment} />
        <KV k="python"      v={d.python_version} />
        <KV k="platform"    v={d.platform} />
      </Section>
      <Section title="Models">
        {Object.entries(d.models || {}).map(([k, v]) => (
          <KV key={k} k={k} v={v} />
        ))}
      </Section>
      <Section title="Providers">
        {(d.providers || []).length === 0 ? (
          <div className="text-slate-600 text-[11px]">no providers registered</div>
        ) : (
          d.providers.map((p) => (
            <KV
              key={p.name}
              k={p.name}
              v={`${p.registered ? 'registered' : 'absent'}${p.default_model ? ` · ${p.default_model}` : ''}`}
            />
          ))
        )}
      </Section>
      <Section title="Routing">
        {(d.routing?.modes || []).map((m) => (
          <KV key={m.mode} k={m.mode} v={m.provider} />
        ))}
        {d.routing?.default_provider && (
          <KV k="default" v={d.routing.default_provider} />
        )}
      </Section>
      <Section title="Flags">
        {Object.entries(d.flags || {}).map(([k, v]) => (
          <KV key={k} k={k} v={v ? 'on' : 'off'} />
        ))}
      </Section>
      <Section title="Deployment">
        {Object.entries(d.deployment || {}).map(([k, v]) => (
          <KV key={k} k={k} v={v} />
        ))}
      </Section>
    </div>
  );
}

interface AgentsData {
  agent_runtime_enabled: boolean;
  owner_agent: { capabilities: string[] };
  internal_agents: Array<{ name: string; description?: string }>;
}

/* ─── Owner Session tab ────────────────────────────────────────────────── */

const ORCHESTRATION_LABELS: Record<OrchestrationCapability, { label: string; detail: string }> = {
  frontend_modification: {
    label: 'Frontend modifications',
    detail: 'Direct edits to React/TSX components.',
  },
  ui_layout_styles: {
    label: 'UI / layout / styles',
    detail: 'Tailwind classes, inline styles, design tokens.',
  },
  frontend_refactor: {
    label: 'Frontend refactors',
    detail: 'Component boundaries, hooks, routing, state shape.',
  },
  page_component_crud: {
    label: 'Page / component CRUD',
    detail: 'Create, rename, or remove pages and components.',
  },
  project_structure_changes: {
    label: 'Project structure changes',
    detail: 'File moves, directory renames, import path updates.',
  },
  internal_orchestration_tools: {
    label: 'Internal orchestration tools',
    detail: 'delegate, spawn_specialist, memory inspector, tool history.',
  },
  autonomous_architectural_edits: {
    label: 'Autonomous architectural edits',
    detail: 'Multi-step edits without per-step confirmation gates.',
  },
  reduced_confirmation_friction: {
    label: 'Reduced confirmation friction',
    detail: 'Skip safe-assistant disclaimers and review prompts.',
  },
};

const ORCHESTRATION_IDS = ORCHESTRATION_CAPABILITY_IDS;

const SAFETY_RETAINED = [
  'Malware authoring (ransomware, spyware, rootkits, keyloggers)',
  'Credential theft, phishing kits, MFA bypass against third parties',
  'Weaponised exploit development against systems you do not control',
  'DDoS / mass / supply-chain compromise tooling',
  'Detection evasion for offensive deployment',
  'Illegal intrusion guidance',
];

function SessionTab({ ownerMode }: { ownerMode: OwnerModeState }) {
  const orchCaps = new Set<string>(ownerMode.orchestrationCapabilities);
  const allOrch = ORCHESTRATION_IDS;

  return (
    <div>
      <Section title="Session State">
        <div className="rounded-lg border border-amber-500/20 bg-gradient-to-br from-amber-500/[0.06] to-fuchsia-500/[0.04] p-3 mb-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-300" />
            </span>
            <div className="text-[12px] font-semibold text-amber-200">
              {ownerMode.isOwner ? 'Owner Session Active' : 'Owner session not active'}
            </div>
          </div>
          <div className="text-[10px] text-amber-300/70">
            {ownerMode.isOwner
              ? `${orchCaps.size} of ${allOrch.length} orchestration permissions granted. The supervisor and every delegated specialist see the OWNER MODE authorisation block in their system prompt.`
              : 'Confirm OWNER_TOKEN is set on Railway and stored in localStorage on this device.'}
          </div>
        </div>
      </Section>

      <Section title="Active orchestration permissions">
        <div className="grid grid-cols-1 gap-1.5">
          {allOrch.map((cap) => {
            const active = orchCaps.has(cap);
            const meta = ORCHESTRATION_LABELS[cap];
            return (
              <div
                key={cap}
                className={`flex items-start gap-2.5 rounded-md border px-2.5 py-1.5 ${
                  active
                    ? 'border-amber-500/20 bg-amber-500/[0.04]'
                    : 'border-white/[0.04] bg-white/[0.015] opacity-50'
                }`}
              >
                <div
                  className={`mt-0.5 h-1.5 w-1.5 rounded-full shrink-0 ${
                    active ? 'bg-amber-300' : 'bg-slate-700'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className={`text-[11px] ${active ? 'text-slate-100' : 'text-slate-500'}`}>
                    {meta.label}
                  </div>
                  <div className="text-[10px] text-slate-600 mt-0.5">{meta.detail}</div>
                  <div className="text-[9px] text-slate-700 font-mono mt-0.5">{cap}</div>
                </div>
                <span
                  className={`text-[9px] uppercase tracking-wider shrink-0 ${
                    active ? 'text-amber-300/80' : 'text-slate-600'
                  }`}
                >
                  {active ? 'granted' : 'inactive'}
                </span>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Still blocked (non-negotiable)">
        <div className="rounded-md border border-rose-500/15 bg-rose-500/[0.03] p-2.5">
          <div className="text-[10px] text-rose-300/80 mb-1.5">
            Owner mode does NOT relax safety policy. Requests in any of
            the following categories are refused regardless of who's asking:
          </div>
          <ul className="space-y-0.5">
            {SAFETY_RETAINED.map((s) => (
              <li key={s} className="text-[10px] text-slate-400 flex items-start gap-1.5">
                <span className="text-rose-400/60 mt-0.5">×</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {ownerMode.debug && (
        <Section title="Detection diagnostic">
          <div className="space-y-1">
            <KV k="enable_admin_mode"   v={String(ownerMode.debug.enable_admin_mode)} />
            <KV k="owner_email_set"     v={String(ownerMode.debug.owner_email_set)} />
            <KV k="owner_id_set"        v={String(ownerMode.debug.owner_id_set)} />
            <KV k="owner_token_set"     v={String(ownerMode.debug.owner_token_set)} />
            <KV k="owner_token_matches" v={String(ownerMode.debug.owner_token_matches)} />
            <KV k="user_kind"           v={ownerMode.debug.user_kind ?? '—'} />
            <KV k="user_email_observed" v={ownerMode.debug.user_email_observed || '—'} />
            <KV k="user_email_match"    v={String(ownerMode.debug.user_email_match)} />
            <KV k="first_failure"       v={ownerMode.debug.first_failure ?? 'none — owner confirmed'} />
          </div>
        </Section>
      )}
    </div>
  );
}

function AgentsTab() {
  const [d, setD] = useState<AgentsData | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetchAdmin<AgentsData>('/v2/admin/agents').then((res) => {
      setD(res);
      setLoading(false);
    });
  }, []);
  if (loading) return <Loading />;
  if (!d) return <Empty message="Agents view unavailable." />;
  return (
    <div>
      <Section title="Runtime">
        <KV k="agent_runtime" v={d.agent_runtime_enabled ? 'enabled' : 'disabled'} />
      </Section>
      <Section title="Owner Agent — Capabilities">
        <div className="flex flex-wrap gap-1.5">
          {(d.owner_agent?.capabilities || []).map((c) => (
            <span
              key={c}
              className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/[0.06] border border-amber-500/15 text-amber-200"
            >
              {c}
            </span>
          ))}
        </div>
      </Section>
      <Section title="Internal Agents">
        {(d.internal_agents || []).length === 0 ? (
          <div className="text-slate-600 text-[11px]">
            No internal-agent registry yet. Reserved slot.
          </div>
        ) : (
          d.internal_agents.map((a) => (
            <KV key={a.name} k={a.name} v={a.description || '—'} />
          ))
        )}
      </Section>
    </div>
  );
}

interface MemoryData {
  available: boolean;
  rows: Array<{ role: string; content: string }>;
  limit: number;
}

function MemoryTab() {
  const [d, setD] = useState<MemoryData | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetchAdmin<MemoryData>('/v2/admin/memory?limit=25').then((res) => {
      setD(res);
      setLoading(false);
    });
  }, []);
  if (loading) return <Loading />;
  if (!d || !d.available) return <Empty message="Memory subsystem not available in this deployment." />;
  if (d.rows.length === 0) return <Empty message="No memory rows for the current user." />;
  return (
    <div className="space-y-2">
      {d.rows.map((row, i) => (
        <div
          key={i}
          className="rounded-md border border-white/[0.04] p-2 bg-white/[0.015]"
        >
          <div className="text-[9px] uppercase text-slate-600 mb-1">{row.role}</div>
          <div className="text-[11px] text-slate-300 whitespace-pre-wrap break-words">
            {row.content.slice(0, 600)}
          </div>
        </div>
      ))}
    </div>
  );
}

interface ToolsData {
  calls: Array<{ name?: string; ts?: string; status?: string; elapsed_ms?: number }>;
  limit: number;
}

function ToolsTab() {
  const [d, setD] = useState<ToolsData | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetchAdmin<ToolsData>('/v2/admin/tools/history').then((res) => {
      setD(res);
      setLoading(false);
    });
  }, []);
  if (loading) return <Loading />;
  if (!d || d.calls.length === 0) return <Empty message="No recorded tool calls." />;
  return (
    <div>
      {d.calls.map((c, i) => (
        <KV
          key={i}
          k={c.name || `call_${i}`}
          v={`${c.status || '?'}${c.elapsed_ms != null ? ` · ${c.elapsed_ms}ms` : ''}${c.ts ? ` · ${c.ts}` : ''}`}
        />
      ))}
    </div>
  );
}

interface PromptsData {
  prompts: Record<string, string>;
  owner_agent_capabilities: string[];
}

function PromptsTab() {
  const [d, setD] = useState<PromptsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    fetchAdmin<PromptsData>('/v2/admin/prompts').then((res) => {
      setD(res);
      setLoading(false);
    });
  }, []);
  if (loading) return <Loading />;
  if (!d) return <Empty message="Prompts view unavailable." />;
  const entries = Object.entries(d.prompts || {});
  return (
    <div>
      <Section title="System Prompts">
        {entries.length === 0 ? (
          <div className="text-slate-600 text-[11px]">No prompts loaded.</div>
        ) : (
          entries.map(([name, body]) => (
            <div key={name} className="mb-2 border border-white/[0.04] rounded-md">
              <button
                onClick={() => setExpanded(expanded === name ? null : name)}
                className="w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
              >
                <span className="text-[11px] font-mono text-amber-300/80">{name}</span>
                <span className="text-[10px] text-slate-600">{body.length} chars</span>
              </button>
              {expanded === name && (
                <pre className="px-3 py-2 text-[10px] text-slate-400 whitespace-pre-wrap break-words border-t border-white/[0.04] max-h-64 overflow-y-auto font-mono">
                  {body}
                </pre>
              )}
            </div>
          ))
        )}
      </Section>
    </div>
  );
}

interface AuditEntry {
  id: number;
  ts: string;
  user_id: string;
  user_email: string | null;
  action: string;
  path: string | null;
  ip: string | null;
  status: string;
  metadata: Record<string, unknown>;
}

interface AuditData {
  entries: AuditEntry[];
  limit: number;
  scope: string;
  total: number;
}

function AuditTab() {
  const [d, setD] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    fetchAdmin<AuditData>('/v2/admin/audit?limit=100&scope=self').then((res) => {
      setD(res);
      setLoading(false);
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Loading />;
  if (!d || d.entries.length === 0) return <Empty message="No audit entries yet." />;
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-slate-500">
          {d.entries.length} of {d.total} entries
        </span>
        <button
          onClick={load}
          className="text-[10px] text-amber-300/80 hover:text-amber-200"
        >
          refresh
        </button>
      </div>
      <div className="space-y-1">
        {d.entries.map((e) => (
          <div
            key={e.id}
            className={`text-[11px] font-mono rounded border px-2 py-1 ${
              e.status === 'blocked'
                ? 'border-rose-500/20 bg-rose-500/[0.04] text-rose-200'
                : 'border-white/[0.04] bg-white/[0.015] text-slate-300'
            }`}
          >
            <span className="text-slate-500">{e.ts.slice(11, 19)}</span>
            <span className="mx-2 text-amber-300/80">{e.action}</span>
            <span className="text-slate-500">{e.status}</span>
            {e.path && <span className="text-slate-600 ml-2">{e.path}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

interface OwnerAgentResponse {
  reply: string;
  blocked: boolean;
  block_category: string | null;
  safe_cyber: boolean;
  capability: string;
  model: string;
  provider: string;
}

const CAPABILITIES = [
  'general', 'architecture', 'code_generation', 'debugging',
  'refactoring', 'deployment', 'product_strategy', 'automation',
  'security_review', 'internal_ops',
];

function OwnerAgentTab() {
  const [capability, setCapability] = useState('general');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Array<{ role: string; content: string; blocked?: boolean }>>([]);

  const send = useCallback(async () => {
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    setHistory((h) => [...h, { role: 'user', content: text }]);
    setMessage('');
    try {
      const r = await fetch(`${API_BASE}/v2/admin/owner-agent`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          message: text,
          capability,
          history: history.slice(-20),
        }),
      });
      const body = await r.json();
      const data = (body?.data || {}) as OwnerAgentResponse;
      setHistory((h) => [...h, {
        role: 'assistant',
        content: data.reply || '(no reply)',
        blocked: !!data.blocked,
      }]);
    } catch (e) {
      setHistory((h) => [...h, {
        role: 'assistant',
        content: `Network error: ${e instanceof Error ? e.message : 'unknown'}`,
      }]);
    } finally {
      setBusy(false);
    }
  }, [message, busy, capability, history]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 mb-3">
        <label className="text-[10px] text-slate-500">capability</label>
        <select
          value={capability}
          onChange={(e) => setCapability(e.target.value)}
          className="bg-white/[0.03] border border-white/[0.06] rounded-md text-[11px] text-slate-200 px-2 py-1 focus:outline-none focus:border-amber-500/30"
        >
          {CAPABILITIES.map((c) => (
            <option key={c} value={c} className="bg-[#0b0b12]">{c}</option>
          ))}
        </select>
        {history.length > 0 && (
          <button
            onClick={() => setHistory([])}
            className="ml-auto text-[10px] text-slate-500 hover:text-slate-300"
          >
            clear
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 mb-2">
        {history.length === 0 ? (
          <Empty message="Owner Agent — architecture, debug, refactor, deployment, security review. Safety guardrails apply." />
        ) : (
          history.map((m, i) => (
            <div
              key={i}
              className={`rounded-md p-2 text-[11px] whitespace-pre-wrap break-words ${
                m.role === 'user'
                  ? 'bg-amber-500/[0.04] border border-amber-500/15 text-amber-100'
                  : m.blocked
                    ? 'bg-rose-500/[0.04] border border-rose-500/20 text-rose-200'
                    : 'bg-white/[0.02] border border-white/[0.05] text-slate-200'
              }`}
            >
              <div className="text-[9px] uppercase text-slate-500 mb-1">
                {m.role}{m.blocked ? ' · blocked' : ''}
              </div>
              {m.content}
            </div>
          ))
        )}
      </div>

      <div className="flex items-end gap-2 border-t border-white/[0.05] pt-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Ask the Owner Agent…  (Cmd/Ctrl-Enter to send)"
          className="flex-1 min-h-[44px] max-h-32 resize-none rounded-md bg-white/[0.02] border border-white/[0.05] focus:border-amber-500/30 focus:outline-none px-3 py-2 text-[11px] text-slate-200"
        />
        <button
          onClick={send}
          disabled={busy || !message.trim()}
          className="px-3 py-2 rounded-md bg-amber-500/[0.1] border border-amber-500/30 text-amber-200 text-[11px] disabled:opacity-40 hover:bg-amber-500/[0.15] transition-all"
        >
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
