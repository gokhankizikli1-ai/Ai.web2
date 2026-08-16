/**
 * ConnectorsPage — "connected accounts and tools for my Korvix account".
 *
 * WHAT THIS PAGE IS NOW
 * ---------------------
 * An ACCOUNT-level surface. It answers "which providers has my Korvix account
 * authorized, and which of my projects use them" — it is no longer a
 * project-scoped configuration screen, so the mandatory project dropdown that
 * used to gate the whole page is gone. You authorize Gmail (or Calendar, GitHub,
 * Vercel, Slack) ONCE; letting a project use it is a separate, explicit act.
 *
 * LAYOUT
 * ------
 * A compact two-column grid on desktop, one column below `md`. Each card shows
 * only the essentials — logo, provider, status, one line of account/usage
 * summary, and the primary action. Everything provider-specific (project access,
 * repository / Vercel-project / Slack-channel selection, disconnect warnings)
 * lives in a Manage DRAWER built on the existing `ui/sheet` primitive, so five
 * connectors no longer consume a screen and a twentieth would still fit.
 *
 * WHERE THE PROVIDER LOGIC LIVES
 * ------------------------------
 * The per-project cards (with each provider's own server-revalidated resource
 * picker) were NOT rewritten — they moved to
 * `components/connectors/ProjectConnectorCards` and render inside the drawer,
 * scoped to the project being configured. So the Slack channel picker is still
 * the same hardened flow; it simply no longer makes a landing-page card several
 * hundred pixels tall.
 *
 * TRUTHFULNESS
 * ------------
 * Nothing here fakes a connection state. Every status comes from
 * `/v2/connectors` (backend authority); a provider switched off on the
 * deployment is shown as unavailable rather than silently hidden; and no card
 * claims a project is connected unless the backend says so.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Loader2, RefreshCw, Plus, Check, X, FolderOpen,
  AlertTriangle, Settings2, ExternalLink,
} from 'lucide-react';
import Navbar from '@/sections/Navbar';
import ToastNotifications from '@/components/ToastNotifications';
import { useToast } from '@/hooks/useToast';
import { resolveBackTarget } from '@/lib/shellNavigation';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import {
  GmailLogo, GithubLogo, VercelLogo, GoogleCalendarLogo, SlackLogo,
} from '@/components/connectors/BrandLogos';
import {
  GmailCard, CalendarCard, GithubCard, VercelCard, SlackCard, type Notify,
} from '@/components/connectors/ProjectConnectorCards';
import {
  listConnectors, listConnectorProjects, bindConnectorToProject,
  unbindConnectorFromProject, disconnectConnectorAccount, syncConnectorAccount,
  beginAccountConnectRedirect,
  type ConnectorSummary, type ConnectorProjectRow,
} from '@/lib/connectorsApi';
import {
  connectorStatus, connectorSummaryLine, type ConnectorStatusTone,
} from '@/lib/connectorStatus';

/* ══════════════════════════════════════════════════════════════════════════
   Small shared bits
   ══════════════════════════════════════════════════════════════════════════ */

const btnPrimary = 'inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg text-[12.5px] font-medium text-white bg-[#3B82F6]/[0.16] border border-[#3B82F6]/30 hover:bg-[#3B82F6]/[0.24] transition-all disabled:opacity-50 disabled:cursor-not-allowed';
const btnGhost = 'inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg text-[12.5px] font-medium text-white/70 border border-white/10 hover:text-white hover:bg-white/[0.05] transition-all disabled:opacity-50 disabled:cursor-not-allowed';
const btnDanger = 'inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg text-[12.5px] font-medium text-[#F87171] border border-[#F87171]/25 hover:bg-[#F87171]/[0.08] transition-all disabled:opacity-50 disabled:cursor-not-allowed';

const TONE_STYLE: Record<ConnectorStatusTone, { color: string; bg: string; border: string }> = {
  connected: { color: '#6EE7B7', bg: 'rgba(52,211,153,0.10)', border: 'rgba(52,211,153,0.22)' },
  attention: { color: '#FCD34D', bg: 'rgba(251,191,36,0.10)', border: 'rgba(251,191,36,0.22)' },
  muted: { color: 'rgba(226,232,240,0.55)', bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.10)' },
};

function StatusPill({ tone, label }: { tone: ConnectorStatusTone; label: string }) {
  const s = TONE_STYLE[tone];
  return (
    <span
      className="shrink-0 inline-flex items-center rounded-full px-2 h-[20px] text-[10.5px] font-medium whitespace-nowrap"
      style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}
    >
      {label}
    </span>
  );
}

function ProviderLogo({ provider, size = 22 }: { provider: string; size?: number }) {
  switch (provider) {
    case 'gmail': return <GmailLogo size={size} />;
    case 'calendar': return <GoogleCalendarLogo size={size} />;
    case 'github': return <GithubLogo size={size} />;
    case 'vercel': return <VercelLogo size={size} />;
    case 'slack': return <SlackLogo size={size} />;
    default: return null;
  }
}

/** One-line description of what a provider contributes. Deliberately SHORT —
 *  the long explanations that used to fill every card now live in the drawer. */
const PROVIDER_BLURB: Record<string, string> = {
  gmail: 'Inbox signals from a connected mailbox',
  calendar: 'Meetings and scheduling signals',
  github: 'Repository activity and releases',
  vercel: 'Deployment status and build health',
  slack: 'Channel activity from your workspace',
};

/* ══════════════════════════════════════════════════════════════════════════
   Compact account-level card
   ══════════════════════════════════════════════════════════════════════════ */

function ConnectorCard({
  connector, busy, onConnect, onSync, onManage,
}: {
  connector: ConnectorSummary;
  busy: 'connect' | 'sync' | null;
  onConnect: () => void;
  onSync: () => void;
  onManage: () => void;
}) {
  const status = connectorStatus(connector);
  const summary = connectorSummaryLine(connector);
  const authorized = !!connector.authorization?.authorized;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl p-3.5 flex flex-col gap-2.5 min-w-0"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      {/* Row 1 — logo · provider · status */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className="shrink-0 h-8 w-8 rounded-lg flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <ProviderLogo provider={connector.provider} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-medium text-white truncate">{connector.label}</div>
          <div className="text-[11.5px] text-white/40 truncate">
            {PROVIDER_BLURB[connector.provider] || ''}
          </div>
        </div>
        <StatusPill tone={status.tone} label={status.label} />
      </div>

      {/* Row 2 — connected account / usage summary (one line, always) */}
      <div className="text-[11.5px] text-white/50 truncate min-w-0" title={summary}>
        {summary}
      </div>

      {/* Row 3 — primary action */}
      <div className="flex items-center gap-1.5 pt-0.5">
        {!connector.enabled ? (
          <span className="text-[11.5px] text-white/30">Unavailable on this deployment</span>
        ) : !authorized ? (
          <button type="button" onClick={onConnect} disabled={busy === 'connect'} className={btnPrimary}>
            {busy === 'connect' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Connect
          </button>
        ) : (
          <>
            <button type="button" onClick={onSync} disabled={busy === 'sync'} className={btnGhost}>
              {busy === 'sync' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Sync
            </button>
            <button type="button" onClick={onManage} className={btnGhost}>
              <Settings2 className="h-3.5 w-3.5" /> Manage
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Manage drawer — project access + per-project resource configuration
   ══════════════════════════════════════════════════════════════════════════ */

function ProjectConnectorConfig({
  provider, projectId, notify,
}: { provider: string; projectId: string; notify: Notify }) {
  // Each provider's OWN card, scoped to this project. Same endpoints, same
  // server-side revalidation of every chosen resource — reused, never re-done.
  switch (provider) {
    case 'gmail': return <GmailCard projectId={projectId} notify={notify} />;
    case 'calendar': return <CalendarCard projectId={projectId} notify={notify} />;
    case 'github': return <GithubCard projectId={projectId} notify={notify} />;
    case 'vercel': return <VercelCard projectId={projectId} notify={notify} />;
    case 'slack': return <SlackCard projectId={projectId} notify={notify} />;
    default: return null;
  }
}

function ManageDrawer({
  connector, open, onOpenChange, notify, onChanged,
}: {
  connector: ConnectorSummary | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  notify: Notify;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<ConnectorProjectRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyProject, setBusyProject] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const provider = connector?.provider ?? '';

  const load = useCallback(async () => {
    if (!provider) return;
    const res = await listConnectorProjects(provider);
    if (res.ok) { setRows(res.data.projects); setLoadError(null); }
    else { setRows([]); setLoadError(res.message); }
  }, [provider]);

  useEffect(() => {
    if (!open || !provider) return;
    let cancelled = false;
    const reload = async () => {
      // Reset + fetch inside the async continuation so opening the drawer is a
      // single settled update rather than a synchronous cascade.
      if (cancelled) return;
      setRows(null); setLoadError(null); setConfiguring(null); setConfirmDisconnect(false);
      const res = await listConnectorProjects(provider);
      if (cancelled) return;
      if (res.ok) { setRows(res.data.projects); setLoadError(null); }
      else { setRows([]); setLoadError(res.message); }
    };
    void reload();
    return () => { cancelled = true; };
  }, [open, provider]);

  const toggleProject = useCallback(async (row: ConnectorProjectRow) => {
    if (!provider) return;
    setBusyProject(row.project_id);
    const res = row.bound
      ? await unbindConnectorFromProject(provider, row.project_id)
      : await bindConnectorToProject(provider, row.project_id);
    setBusyProject(null);
    if (!res.ok) { notify(res.message, 'error'); return; }
    if (!row.bound) {
      const needsResource = 'requires_resource_selection' in res.data
        && (res.data as { requires_resource_selection?: boolean }).requires_resource_selection;
      notify(needsResource
        ? `Added to ${row.project_name || 'the project'} — choose what it may read.`
        : `Added to ${row.project_name || 'the project'}.`, 'success');
      if (needsResource) setConfiguring(row.project_id);
    } else {
      notify(`Removed from ${row.project_name || 'the project'}. Other projects are unaffected.`, 'success');
    }
    await load();
    onChanged();
  }, [provider, notify, load, onChanged]);

  const doDisconnect = useCallback(async () => {
    if (!provider) return;
    setDisconnecting(true);
    const res = await disconnectConnectorAccount(provider);
    setDisconnecting(false);
    setConfirmDisconnect(false);
    if (!res.ok) { notify(res.message, 'error'); return; }
    notify(`${connector?.label ?? 'Connector'} disconnected from your account.`, 'success');
    onOpenChange(false);
    onChanged();
  }, [provider, connector, notify, onOpenChange, onChanged]);

  if (!connector) return null;
  const auth = connector.authorization;
  const boundCount = rows ? rows.filter((r) => r.bound).length : (auth?.project_count ?? 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[440px] p-0 border-l border-white/[0.07] overflow-y-auto"
        style={{ background: '#0c1016' }}
      >
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-white/[0.06]">
          <SheetTitle className="flex items-center gap-2.5 text-white text-[15px]">
            <ProviderLogo provider={connector.provider} size={20} />
            {connector.label}
          </SheetTitle>
          <SheetDescription className="text-[12.5px] text-white/45">
            {auth?.account_label
              ? `Connected as ${auth.account_label}`
              : 'Connected to your Korvix account'}
            {auth?.last_sync_at ? ` · last sync ${new Date(auth.last_sync_at).toLocaleString()}` : ''}
          </SheetDescription>
        </SheetHeader>

        <div className="px-5 py-4 space-y-5">
          {/* ── Project access ───────────────────────────────────────────── */}
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-white/35 mb-1.5">
              Use in projects
            </h3>
            <p className="text-[11.5px] text-white/40 mb-2.5">
              Authorizing {connector.label} does not share it with anything. Pick the
              projects that may read from it — each one keeps its own
              {connector.resource_noun ? ` ${connector.resource_noun}` : ''} selection.
            </p>

            {rows === null ? (
              <div className="flex items-center gap-2 text-[12px] text-white/40 py-3">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading projects…
              </div>
            ) : loadError ? (
              <div className="flex items-start gap-2 text-[12px] text-[#FCA5A5] py-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {loadError}
              </div>
            ) : rows.length === 0 ? (
              <p className="text-[12px] text-white/40 py-2">
                No projects yet. <Link to="/projects" className="text-[#60A5FA] hover:underline">Create one</Link>,
                then come back to give it access.
              </p>
            ) : (
              <div className="space-y-1">
                {rows.map((row) => {
                  const pending = row.bound && row.status === 'pending_selection';
                  return (
                    <div key={row.project_id} className="rounded-lg" style={{ border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div className="flex items-center gap-2 px-2.5 py-2 min-w-0">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={row.bound}
                          aria-label={`Use ${connector.label} in ${row.project_name || 'project'}`}
                          onClick={() => { void toggleProject(row); }}
                          disabled={busyProject === row.project_id}
                          className="shrink-0 h-4 w-4 rounded flex items-center justify-center transition-all disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#60A5FA]/60"
                          style={{
                            background: row.bound ? 'rgba(59,130,246,0.20)' : 'rgba(255,255,255,0.03)',
                            border: `1px solid ${row.bound ? 'rgba(59,130,246,0.45)' : 'rgba(255,255,255,0.12)'}`,
                          }}
                        >
                          {busyProject === row.project_id
                            ? <Loader2 className="h-2.5 w-2.5 animate-spin text-white/60" />
                            : row.bound ? <Check className="h-2.5 w-2.5 text-[#93C5FD]" /> : null}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12.5px] text-white/85 truncate">
                            {row.project_name || 'Untitled project'}
                          </div>
                          {row.bound && (
                            <div className="text-[10.5px] text-white/35 truncate">
                              {pending
                                ? `Needs ${connector.resource_noun || 'setup'}`
                                : row.resources.length > 0
                                  ? row.resources.map((r) => r.resource_label || r.resource_id).join(', ')
                                  : 'Full account access'}
                            </div>
                          )}
                        </div>
                        {row.bound && connector.requires_resource_selection && (
                          <button
                            type="button"
                            onClick={() => setConfiguring((c) => (c === row.project_id ? null : row.project_id))}
                            className="shrink-0 text-[11px] text-[#93C5FD] hover:underline"
                          >
                            {pending
                              ? `Choose ${connector.resource_noun}s`
                              : configuring === row.project_id ? 'Close' : 'Configure'}
                          </button>
                        )}
                      </div>

                      {/* The provider's OWN picker — on demand, never permanent. */}
                      {configuring === row.project_id && (
                        <div className="px-2 pb-2">
                          <ProjectConnectorConfig
                            provider={connector.provider}
                            projectId={row.project_id}
                            notify={(m, t) => { notify(m, t); void load(); onChanged(); }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Account-level disconnect ──────────────────────────────────── */}
          <section className="pt-1 border-t border-white/[0.06]">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-white/35 mt-4 mb-1.5">
              Disconnect account
            </h3>
            {!confirmDisconnect ? (
              <>
                <p className="text-[11.5px] text-white/40 mb-2.5">
                  Removes {connector.label} from your Korvix account and from every project
                  that uses it. To remove access from a single project, untick it above.
                </p>
                <button type="button" onClick={() => setConfirmDisconnect(true)} className={btnDanger}>
                  Disconnect {connector.label}
                </button>
              </>
            ) : (
              <>
                <div
                  className="rounded-lg p-2.5 mb-2.5 flex items-start gap-2"
                  style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.20)' }}
                >
                  <AlertTriangle className="h-3.5 w-3.5 text-[#F87171] mt-0.5 shrink-0" />
                  <p className="text-[11.5px] text-[#FCA5A5]">
                    {boundCount === 0
                      ? `${connector.label} is not used by any project yet. Disconnecting removes the authorization.`
                      : `${boundCount} project${boundCount === 1 ? '' : 's'} will stop receiving ${connector.label} signals.`}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => { void doDisconnect(); }} disabled={disconnecting} className={btnDanger}>
                    {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                    Yes, disconnect
                  </button>
                  <button type="button" onClick={() => setConfirmDisconnect(false)} className={btnGhost}>
                    Cancel
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   PAGE
   ══════════════════════════════════════════════════════════════════════════ */

export default function ConnectorsPage() {
  const { toasts, addToast, removeToast } = useToast();
  const notify: Notify = useCallback((m, t) => addToast(m, t), [addToast]);

  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [connectors, setConnectors] = useState<ConnectorSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ provider: string; kind: 'connect' | 'sync' } | null>(null);
  /* A connector callback lands here as a FRESH document load. Which drawer to
     open is therefore derived once, in a lazy initializer, from the outcome
     params — never set from inside an effect (that would be a render cascade,
     and it would fight the user closing the drawer). */
  const [manageProvider, setManageProvider] = useState<string | null>(() => {
    for (const key of ['gmail', 'calendar', 'github', 'vercel', 'slack']) {
      const value = (searchParams.get(key) || '').trim();
      if (value === 'connected' || value === 'authorized' || value === 'installed') return key;
    }
    return null;
  });

  /* Back — pop the in-app history entry the user came from, so they land back
   * on the exact surface they left. On a cold entry (bookmark, hard refresh, or
   * a connector OAuth callback, which arrives as a fresh document load and so
   * has nothing to pop) fall back to the chat surface instead. The decision
   * itself lives in `resolveBackTarget` so it can be tested without a router. */
  const goBack = useCallback(() => {
    const target = resolveBackTarget({ locationKey: location.key });
    if (target.kind === 'history') navigate(-1);
    else navigate(target.route);
  }, [navigate, location.key]);

  const load = useCallback(async () => {
    const res = await listConnectors();
    if (res.ok) { setConnectors(res.data.connectors); setLoadError(null); }
    else { setConnectors([]); setLoadError(res.message); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const initial = async () => {
      const res = await listConnectors();
      if (cancelled) return;
      if (res.ok) { setConnectors(res.data.connectors); setLoadError(null); }
      else { setConnectors([]); setLoadError(res.message); }
    };
    void initial();
    return () => { cancelled = true; };
  }, []);

  /* ── Connector callback receiver ─────────────────────────────────────────
   * Each backend redirects the browser (a full page load) here:
   *   Gmail:    `?gmail=connected|error&reason=…`
   *   Calendar: `?calendar=connected|error&reason=…`
   *   GitHub:   `?github=authorized|needs_install|error&reason=…`
   *   Vercel:   `?vercel=authorized|error&reason=…`
   *   Slack:    `?slack=authorized|error&reason=…`
   * (An account-level flow carries no `project_id`; a legacy per-project flow
   * still may, and it is only ever used to pre-open that project's config.)
   * The page re-reads real status on mount, so here we only surface ONE toast
   * for the outcome and strip the temporary params so a refresh cannot replay
   * it. Nothing is trusted for connection truth from the URL, and we never
   * redirect based on a URL value — no open-redirect surface. */
  const callbackHandled = useRef(false);
  useEffect(() => {
    if (callbackHandled.current) return;
    const outcomes: [string, string][] = [
      ['gmail', 'Gmail'], ['calendar', 'Google Calendar'], ['github', 'GitHub'],
      ['vercel', 'Vercel'], ['slack', 'Slack'],
    ];
    const hit = outcomes.find(([key]) => searchParams.get(key));
    if (!hit) return;
    callbackHandled.current = true;

    const [key, label] = hit;
    const value = (searchParams.get(key) || '').trim();
    const reasonCode = (searchParams.get('reason') || '').trim();
    const pretty = reasonCode ? ` (${reasonCode.replace(/_/g, ' ')})` : '';
    if (value === 'connected' || value === 'authorized' || value === 'installed') {
      // The drawer is already open (derived above) — this only reports the
      // outcome.
      notify(`${label} connected. Choose which projects may use it.`, 'success');
    } else if (value === 'needs_install') {
      notify(`Almost there — install Korvix on ${label} to finish connecting.`, 'info');
    } else {
      notify(`${label} could not be connected${pretty}.`, 'error');
    }

    const next = new URLSearchParams(searchParams);
    for (const k of ['gmail', 'calendar', 'github', 'vercel', 'slack', 'project_id',
                     'reason', 'state', 'setup_action', 'installation_id',
                     'configurationId', 'teamId', 'next', 'code']) next.delete(k);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, notify]);

  const connect = useCallback(async (provider: string) => {
    setBusy({ provider, kind: 'connect' });
    const res = await beginAccountConnectRedirect(provider);
    if (!res.ok) { setBusy(null); notify(res.message, 'error'); }
    // On success the browser navigates away; leave the spinner in place.
  }, [notify]);

  const sync = useCallback(async (connector: ConnectorSummary) => {
    setBusy({ provider: connector.provider, kind: 'sync' });
    const res = await syncConnectorAccount(connector.provider);
    setBusy(null);
    if (!res.ok) { notify(res.message, 'error'); return; }
    const okCount = res.data.results.filter((r) => r.ok).length;
    const failed = res.data.results.filter((r) => !r.ok);
    if (res.data.projects === 0) {
      notify(`${connector.label} is not used by any project yet — nothing to sync.`, 'info');
    } else if (failed.length === 0) {
      notify(`${connector.label} synced for ${okCount} project${okCount === 1 ? '' : 's'}.`, 'success');
    } else {
      notify(
        `${connector.label} synced ${okCount}/${res.data.projects} project(s); ` +
        `${failed.length} need attention.`, 'info');
    }
    await load();
  }, [notify, load]);

  const active = useMemo(
    () => connectors?.find((c) => c.provider === manageProvider) ?? null,
    [connectors, manageProvider],
  );

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-foreground">
      {/* `surface="dark"` matches the other dark pages that host this shared
          navbar (About, Legal); the default light surface renders slate text on
          this near-black page. */}
      <Navbar surface="dark" variant="app" />
      {/* `pt-24` clears the FIXED h-14 navbar, matching every other page that
          renders it. */}
      <div className="px-4 sm:px-6 pt-24 pb-12">
        <div className="max-w-4xl mx-auto">
          <button
            type="button"
            onClick={goBack}
            className="inline-flex items-center gap-1.5 text-[13px] text-white/45 hover:text-white/80 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="mt-4 mb-6 flex items-end justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-[22px] sm:text-[26px] font-semibold text-white tracking-tight">Connectors</h1>
              <p className="mt-1 text-[13.5px] text-white/45 max-w-xl">
                Connect a tool once to your Korvix account, then choose which projects
                may read from it. Every connection is read-only.
              </p>
            </div>
            <Link to="/projects" className={btnGhost}>
              <FolderOpen className="h-3.5 w-3.5" /> Projects <ExternalLink className="h-3 w-3 opacity-60" />
            </Link>
          </div>

          {connectors === null ? (
            <div className="flex items-center gap-2 text-[13px] text-white/40 py-8">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading connectors…
            </div>
          ) : loadError ? (
            <div
              className="rounded-xl p-4 flex items-start gap-2.5"
              style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.20)' }}
            >
              <AlertTriangle className="h-4 w-4 text-[#F87171] mt-0.5 shrink-0" />
              <div>
                <p className="text-[13px] text-[#FCA5A5]">{loadError}</p>
                <button type="button" onClick={() => { void load(); }} className={`${btnGhost} mt-2.5`}>
                  <RefreshCw className="h-3.5 w-3.5" /> Try again
                </button>
              </div>
            </div>
          ) : (
            /* Compact grid: two columns when there is room, one below md. This
               is what keeps 10–20 connectors browsable without scrolling past
               five tall cards. */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {connectors.map((c) => (
                <ConnectorCard
                  key={c.provider}
                  connector={c}
                  busy={busy?.provider === c.provider ? busy.kind : null}
                  onConnect={() => { void connect(c.provider); }}
                  onSync={() => { void sync(c); }}
                  onManage={() => setManageProvider(c.provider)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <ManageDrawer
        connector={active}
        open={!!active}
        onOpenChange={(v) => { if (!v) setManageProvider(null); }}
        notify={notify}
        onChanged={() => { void load(); }}
      />

      <ToastNotifications toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
