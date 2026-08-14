import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowLeft, RefreshCw, Loader2, CheckCircle2, AlertTriangle, FolderOpen } from 'lucide-react';
import Navbar from '@/sections/Navbar';
import ToastNotifications from '@/components/ToastNotifications';
import { useToast } from '@/hooks/useToast';
import { getProjects } from '@/stores/projectStore';
import type { Project } from '@/types/projects';
import { GmailLogo, GithubLogo } from '@/components/connectors/BrandLogos';
import {
  beginGmailConnectRedirect, getGmailConnection, syncGmail, disconnectGmail,
  type GmailConnectionView,
} from '@/lib/gmailConnectorApi';
import {
  beginGithubConnectRedirect, beginGithubInstallRedirect, getGithubConnection,
  getGithubPendingInstallations, getGithubPendingRepositories,
  selectGithubRepository, syncGithub, disconnectGithub,
  type GithubConnectionView, type GithubRepo, type GithubPendingInstallation,
} from '@/lib/githubConnectorApi';

type Notify = (message: string, type: 'success' | 'error' | 'info') => void;

/* A single connector's remote status: loading, a transport/error state, or a
 * ready state whose `connection` is null when the project is not connected. */
type Loaded<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; connection: T | null };

/* ══════════════════════════════════════════════════════════════════════════
   Shared card shell — premium dark, minimal, consistent with Korvix.
   ══════════════════════════════════════════════════════════════════════════ */
function ConnectorShell({
  logo, name, description, statusPill, children,
}: {
  logo: React.ReactNode;
  name: string;
  description: string;
  statusPill?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl p-5 sm:p-6"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="flex items-start gap-4">
        <div
          className="shrink-0 h-12 w-12 rounded-xl flex items-center justify-center text-white"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          {logo}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[15px] font-semibold text-white">{name}</h3>
            {statusPill}
          </div>
          <p className="mt-1 text-[13px] text-white/45 leading-relaxed">{description}</p>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ tone, label }: { tone: 'connected' | 'revoked' | 'muted'; label: string }) {
  const styles: Record<string, string> = {
    connected: 'text-[#4ADE80] border-[#4ADE80]/25 bg-[#4ADE80]/[0.06]',
    revoked: 'text-[#FACC15] border-[#FACC15]/25 bg-[#FACC15]/[0.06]',
    muted: 'text-white/40 border-white/10 bg-white/[0.03]',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[10.5px] font-medium ${styles[tone]}`}>
      {tone === 'connected' && <CheckCircle2 className="h-3 w-3" />}
      {tone === 'revoked' && <AlertTriangle className="h-3 w-3" />}
      {label}
    </span>
  );
}

/* Button styles matching the app's dark theme. */
const btnPrimary = 'inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-medium text-white bg-[#3B82F6]/[0.16] border border-[#3B82F6]/30 hover:bg-[#3B82F6]/[0.24] transition-all disabled:opacity-50 disabled:cursor-not-allowed';
const btnGhost = 'inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-medium text-white/70 border border-white/10 hover:text-white hover:bg-white/[0.05] transition-all disabled:opacity-50 disabled:cursor-not-allowed';
const btnDanger = 'inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-medium text-[#F87171] border border-[#F87171]/25 hover:bg-[#F87171]/[0.08] transition-all disabled:opacity-50 disabled:cursor-not-allowed';

function BusySpinner() {
  return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
}

/* Turn a failed API result into a friendly, honest message. */
function reason(status: number, message: string): string {
  if (status === 0) return 'Could not reach the server.';
  if (status === 401) return 'Please sign in again.';
  if (status === 404) return 'This project is not available on the server yet.';
  if (status === 503) return 'This connector is not enabled on the server.';
  return message || `Request failed (HTTP ${status}).`;
}

/* Standardized, TRUTHFUL sync summary shared by Gmail + GitHub:
 *   "12 new · 40 already known"  and, when a source failed partway,
 *   "… · 1 source had errors" with an 'info' (not 'success') tone so a partial
 * sync never reads as a clean success. Both report shapes expose the same
 * recorded/deduplicated/errors/ok fields, so one helper serves both. */
function summarizeSync(s: {
  recorded: number; deduplicated: number; errors?: Record<string, string>; ok: boolean;
}): { text: string; tone: 'success' | 'info' } {
  const errCount = s.errors ? Object.keys(s.errors).length : 0;
  let text = `${s.recorded} new · ${s.deduplicated} already known`;
  if (errCount > 0) {
    text += ` · ${errCount} ${errCount === 1 ? 'source' : 'sources'} had errors`;
  }
  return { text, tone: s.ok ? 'success' : 'info' };
}

/* ══════════════════════════════════════════════════════════════════════════
   GMAIL CARD — real OAuth flow via gmailConnectorApi (reused, not duplicated).
   ══════════════════════════════════════════════════════════════════════════ */
function GmailCard({ projectId, notify }: { projectId: string; notify: Notify }) {
  const [status, setStatus] = useState<Loaded<GmailConnectionView>>({ state: 'loading' });
  const [busy, setBusy] = useState<null | 'connect' | 'sync' | 'disconnect'>(null);

  // `load` is await-first: it performs no synchronous setState, so the mount
  // effect that calls it never sets state during render. Loading feedback for a
  // manual retry is set in the click handler (an event, not an effect).
  const load = useCallback(async () => {
    const res = await getGmailConnection(projectId);
    if (res.ok) setStatus({ state: 'ready', connection: res.data.connected ? res.data.connection : null });
    else setStatus({ state: 'error', message: reason(res.status, res.message) });
  }, [projectId]);

  // Load real backend status once on mount (and on project switch, via the
  // card's key-based remount). `load` sets state only after its await resolves;
  // the mount-fetch-then-setState pattern is the same one used elsewhere
  // (e.g. OwnerCosts) and this rule is suppressed there identically.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const onRetry = () => { setStatus({ state: 'loading' }); void load(); };

  const onConnect = async () => {
    setBusy('connect');
    // Starts the real backend OAuth flow and redirects the browser to Google
    // when it succeeds; only surfaces a toast if the START call fails (no
    // navigation happened, so re-enable the button).
    const res = await beginGmailConnectRedirect(projectId);
    if (!res.ok) { notify(reason(res.status, res.message), 'error'); setBusy(null); }
  };

  const onSync = async () => {
    setBusy('sync');
    const res = await syncGmail(projectId);
    setBusy(null);
    if (!res.ok) { notify(reason(res.status, res.message), 'error'); return; }
    const { text, tone } = summarizeSync(res.data.sync);
    notify(`Gmail synced — ${text}.`, tone);
    void load();
  };

  const onDisconnect = async () => {
    setBusy('disconnect');
    const res = await disconnectGmail(projectId);
    setBusy(null);
    if (!res.ok) { notify(reason(res.status, res.message), 'error'); return; }
    notify('Gmail disconnected.', 'success');
    void load();
  };

  const conn = status.state === 'ready' ? status.connection : null;
  const revoked = conn?.status === 'revoked';
  const connected = !!conn && conn.status === 'connected';

  let pill: React.ReactNode = null;
  if (status.state === 'ready') {
    if (connected) pill = <StatusPill tone="connected" label="Connected" />;
    else if (revoked) pill = <StatusPill tone="revoked" label="Reconnect needed" />;
    else pill = <StatusPill tone="muted" label="Not connected" />;
  }

  return (
    <ConnectorShell
      logo={<GmailLogo size={26} />}
      name="Gmail"
      description="Read relevant email activity so Korvix understands what's happening around your project. Read-only — Korvix never sends, deletes, or changes any mail."
      statusPill={pill}
    >
      {status.state === 'loading' && (
        <div className="flex items-center gap-2 text-[13px] text-white/40"><BusySpinner /> Checking status…</div>
      )}

      {status.state === 'error' && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-[#F87171]/90">{status.message}</span>
          <button className={btnGhost} onClick={onRetry}><RefreshCw className="h-3.5 w-3.5" /> Retry</button>
        </div>
      )}

      {status.state === 'ready' && !connected && !revoked && (
        <button className={btnPrimary} disabled={busy === 'connect'} onClick={onConnect}>
          {busy === 'connect' ? <BusySpinner /> : null} Connect Gmail
        </button>
      )}

      {status.state === 'ready' && revoked && (
        <div className="flex flex-wrap items-center gap-2">
          <button className={btnPrimary} disabled={busy === 'connect'} onClick={onConnect}>
            {busy === 'connect' ? <BusySpinner /> : null} Reconnect Gmail
          </button>
          <button className={btnDanger} disabled={busy === 'disconnect'} onClick={onDisconnect}>
            {busy === 'disconnect' ? <BusySpinner /> : null} Remove
          </button>
        </div>
      )}

      {status.state === 'ready' && connected && conn && (
        <div className="space-y-3">
          <div className="text-[13px] text-white/60">
            {conn.google_email ? (
              <>Connected as <span className="text-white font-medium">{conn.google_email}</span></>
            ) : 'Connected.'}
            {conn.last_sync_at && (
              <span className="text-white/35"> · last sync {new Date(conn.last_sync_at).toLocaleString()}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className={btnGhost} disabled={busy !== null} onClick={onSync}>
              {busy === 'sync' ? <BusySpinner /> : <RefreshCw className="h-3.5 w-3.5" />} Sync now
            </button>
            <button className={btnDanger} disabled={busy !== null} onClick={onDisconnect}>
              {busy === 'disconnect' ? <BusySpinner /> : null} Disconnect
            </button>
          </div>
        </div>
      )}
    </ConnectorShell>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   GITHUB CARD — real GitHub App connection flow via githubConnectorApi.
   Connect starts a user-to-server authorization that resolves whether or not the
   Korvix App is already installed (no uninstall/reinstall needed). The callback
   surfaces the server-VERIFIED installation(s) the user can access; the user
   picks an account (when several) and a repository. The frontend never supplies
   an installation id or repo name of its own — both come from the verified set.
   ══════════════════════════════════════════════════════════════════════════ */
/* GitHub connect-flow state.
 *   disconnected   = no connection, nothing pending → show Connect.
 *   needs_install  = user authorized but the App is on no account → offer Install.
 *   choose_install = several verified installations → account picker.
 *   pending        = one installation resolved → repo picker.
 *   connected      = a repo is bound. */
type GhState =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'disconnected' }
  | { state: 'needs_install' }
  | { state: 'choose_install'; installations: GithubPendingInstallation[] }
  | { state: 'pending'; installationId: string; repos: GithubRepo[] }
  | { state: 'connected'; connection: GithubConnectionView };

function GithubCard({
  projectId, notify, initialGithub,
}: { projectId: string; notify: Notify; initialGithub?: string }) {
  // A `needs_install` callback outcome is the one state the backend can't report
  // on a fresh load (there is nothing pending), so seed it from the callback hint.
  const [status, setStatus] = useState<GhState>(
    initialGithub === 'needs_install' ? { state: 'needs_install' } : { state: 'loading' },
  );
  const [busy, setBusy] = useState<null | 'connect' | 'install' | 'choose' | 'select' | 'sync' | 'disconnect'>(null);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [selectedInstall, setSelectedInstall] = useState('');
  // Skip the mount load when we deliberately seeded needs_install from the hint.
  const skipInitialLoad = useRef(initialGithub === 'needs_install');

  // Resolve the repositories for ONE verified installation → the repo picker.
  const loadReposFor = useCallback(async (installationId: string): Promise<boolean> => {
    const repos = await getGithubPendingRepositories(projectId, installationId);
    if (repos.ok) {
      setStatus({ state: 'pending', installationId, repos: repos.data.repositories });
      return true;
    }
    return false;
  }, [projectId]);

  const load = useCallback(async () => {
    const conn = await getGithubConnection(projectId);
    if (conn.ok && conn.data.connected && conn.data.connection) {
      setStatus({ state: 'connected', connection: conn.data.connection });
      return;
    }
    if (!conn.ok) { setStatus({ state: 'error', message: reason(conn.status, conn.message) }); return; }
    // Not connected — which verified installations are pending? (Cheap, no
    // GitHub call; the backend returns an empty list when there are none.)
    const pend = await getGithubPendingInstallations(projectId);
    if (pend.ok && pend.data.count > 1) {
      setStatus({ state: 'choose_install', installations: pend.data.installations });
      return;
    }
    if (pend.ok && pend.data.count === 1) {
      if (await loadReposFor(pend.data.installations[0].installation_id)) return;
    }
    setStatus({ state: 'disconnected' });
  }, [projectId, loadReposFor]);

  // Load real backend status once on mount (and on project switch, via the
  // card's key-based remount). `load` is await-first (no synchronous setState),
  // and the seeded `needs_install` state is skipped here.
  useEffect(() => {
    if (skipInitialLoad.current) { skipInitialLoad.current = false; return; }
    void load();
  }, [load]);

  const onRetry = () => { setStatus({ state: 'loading' }); void load(); };

  // Disconnected → start the user-authorization flow (resolves an existing
  // installation OR lets the user install when none exists). Redirects to GitHub.
  const onConnect = async () => {
    setBusy('connect');
    const res = await beginGithubConnectRedirect(projectId);
    if (!res.ok) { notify(reason(res.status, res.message), 'error'); setBusy(null); }
    // On success the browser is navigating to GitHub — leave busy set.
  };

  // needs_install / "change repositories" → GitHub's App install/configure page.
  const onInstall = async () => {
    setBusy('install');
    const res = await beginGithubInstallRedirect(projectId);
    if (!res.ok) { notify(reason(res.status, res.message), 'error'); setBusy(null); }
  };

  // choose_install → resolve the chosen account's repositories → repo picker.
  const onChoose = async (installs: GithubPendingInstallation[]) => {
    const chosen = selectedInstall || installs[0]?.installation_id || '';
    if (!chosen) { notify('Choose a GitHub account to connect.', 'error'); return; }
    setBusy('choose');
    const ok = await loadReposFor(chosen);
    setBusy(null);
    if (!ok) notify('Could not list repositories for that account.', 'error');
  };

  // Pending → finalize by selecting one of the installation's repositories.
  const onSelect = async (installationId: string, repos: GithubRepo[]) => {
    const chosen = selectedRepo || repos[0]?.full_name || '';
    if (!chosen) { notify('Choose a repository to connect.', 'error'); return; }
    setBusy('select');
    const res = await selectGithubRepository(projectId, chosen, installationId);
    setBusy(null);
    if (!res.ok) { notify(reason(res.status, res.message), 'error'); return; }
    notify(`GitHub connected — ${res.data.connection.repo_full_name}.`, 'success');
    void load();
  };

  const onSync = async () => {
    setBusy('sync');
    const res = await syncGithub(projectId);
    setBusy(null);
    if (!res.ok) { notify(reason(res.status, res.message), 'error'); return; }
    const { text, tone } = summarizeSync(res.data.sync);
    notify(`GitHub synced — ${text}.`, tone);
    void load();
  };

  const onDisconnect = async () => {
    setBusy('disconnect');
    const res = await disconnectGithub(projectId);
    setBusy(null);
    if (!res.ok) { notify(reason(res.status, res.message), 'error'); return; }
    notify('GitHub disconnected.', 'success');
    void load();
  };

  let pill: React.ReactNode = null;
  if (status.state === 'connected') pill = <StatusPill tone="connected" label="Connected" />;
  else if (status.state === 'pending') pill = <StatusPill tone="revoked" label="Choose a repository" />;
  else if (status.state === 'choose_install') pill = <StatusPill tone="revoked" label="Choose an account" />;
  else if (status.state === 'needs_install') pill = <StatusPill tone="revoked" label="Install needed" />;
  else if (status.state === 'disconnected') pill = <StatusPill tone="muted" label="Not connected" />;

  const selectCls = 'w-full h-10 rounded-lg bg-white/[0.03] border border-white/10 px-3 pr-9 text-[13px] text-white outline-none focus:border-[#3B82F6]/40 transition-colors appearance-none';

  return (
    <ConnectorShell
      logo={<GithubLogo size={24} className="text-white" />}
      name="GitHub"
      description="Repository activity, pull requests, checks and development context — turned into project observations. Read-only: Korvix never pushes, merges, or changes your repo."
      statusPill={pill}
    >
      {status.state === 'loading' && (
        <div className="flex items-center gap-2 text-[13px] text-white/40"><BusySpinner /> Checking status…</div>
      )}

      {status.state === 'error' && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-[#F87171]/90">{status.message}</span>
          <button className={btnGhost} onClick={onRetry}><RefreshCw className="h-3.5 w-3.5" /> Retry</button>
        </div>
      )}

      {status.state === 'disconnected' && (
        <div className="space-y-2">
          <button className={btnPrimary} disabled={busy === 'connect'} onClick={onConnect}>
            {busy === 'connect' ? <BusySpinner /> : null} Connect GitHub
          </button>
          <p className="text-[11.5px] text-white/30 leading-relaxed">
            Opens GitHub to authorize Korvix. If the app isn't installed yet you can add it — you choose{' '}
            <span className="text-white/50">All repositories</span> or only specific ones on GitHub, then pick which
            repo to connect here.
          </p>
        </div>
      )}

      {status.state === 'needs_install' && (
        <div className="space-y-2">
          <div className="text-[13px] text-white/55">
            You authorized Korvix, but it isn't installed on any GitHub account yet.
          </div>
          <button className={btnPrimary} disabled={busy === 'install'} onClick={onInstall}>
            {busy === 'install' ? <BusySpinner /> : null} Install on GitHub
          </button>
        </div>
      )}

      {status.state === 'choose_install' && (
        <div className="space-y-3 max-w-md">
          <div className="text-[12.5px] text-white/45">Choose the GitHub account to connect:</div>
          <div className="relative">
            <select
              aria-label="GitHub account"
              className={selectCls}
              value={selectedInstall || status.installations[0].installation_id}
              onChange={(e) => setSelectedInstall(e.target.value)}
            >
              {status.installations.map((i) => (
                <option key={i.installation_id} value={i.installation_id} className="bg-[#0a0a0f] text-white">
                  {i.account_login || `Installation ${i.installation_id}`}
                  {i.account_type ? ` (${i.account_type})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className={btnPrimary} disabled={busy === 'choose'} onClick={() => onChoose(status.installations)}>
              {busy === 'choose' ? <BusySpinner /> : null} Continue
            </button>
            <button className={btnGhost} disabled={busy === 'install'} onClick={onInstall}>
              {busy === 'install' ? <BusySpinner /> : null} Manage on GitHub
            </button>
          </div>
        </div>
      )}

      {status.state === 'pending' && (
        <div className="space-y-3 max-w-md">
          {status.repos.length > 0 ? (
            <>
              <div className="text-[12.5px] text-white/45">GitHub app installed. Choose a repository to connect:</div>
              <div className="relative">
                <select
                  aria-label="Repository"
                  className={selectCls}
                  value={selectedRepo || status.repos[0].full_name}
                  onChange={(e) => setSelectedRepo(e.target.value)}
                >
                  {status.repos.map((r) => (
                    <option key={r.id || r.full_name} value={r.full_name} className="bg-[#0a0a0f] text-white">
                      {r.full_name}{r.private ? ' (private)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button className={btnPrimary} disabled={busy === 'select'} onClick={() => onSelect(status.installationId, status.repos)}>
                  {busy === 'select' ? <BusySpinner /> : null} Connect repository
                </button>
                <button className={btnGhost} disabled={busy === 'install'} onClick={onInstall}>
                  {busy === 'install' ? <BusySpinner /> : null} Change repositories on GitHub
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <div className="text-[13px] text-white/55">
                The GitHub app is installed but has access to no repositories.
              </div>
              <button className={btnPrimary} disabled={busy === 'install'} onClick={onInstall}>
                {busy === 'install' ? <BusySpinner /> : null} Grant repository access on GitHub
              </button>
            </div>
          )}
        </div>
      )}

      {status.state === 'connected' && (
        <div className="space-y-3">
          <div className="text-[13px] text-white/60">
            Connected to <span className="text-white font-medium">{status.connection.repo_full_name}</span>
            {status.connection.last_sync_at && (
              <span className="text-white/35"> · last sync {new Date(status.connection.last_sync_at).toLocaleString()}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className={btnGhost} disabled={busy !== null} onClick={onSync}>
              {busy === 'sync' ? <BusySpinner /> : <RefreshCw className="h-3.5 w-3.5" />} Sync now
            </button>
            <button className={btnDanger} disabled={busy !== null} onClick={onDisconnect}>
              {busy === 'disconnect' ? <BusySpinner /> : null} Disconnect
            </button>
          </div>
        </div>
      )}
    </ConnectorShell>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   PAGE
   ══════════════════════════════════════════════════════════════════════════ */
export default function ConnectorsPage() {
  const { toasts, addToast, removeToast } = useToast();
  const notify: Notify = useCallback((m, t) => addToast(m, t), [addToast]);

  // localStorage snapshot of the user's projects (the existing project store).
  const projects = useMemo<Project[]>(() => {
    try { return getProjects(); } catch { return []; }
  }, []);

  const [searchParams, setSearchParams] = useSearchParams();

  // Initial project selection. The Gmail OAuth callback returns to
  // `/#/settings/integrations?...&project_id=<id>`; if that id is one the user
  // actually has locally we pre-select it (never trusting an arbitrary id for
  // anything but selection). Otherwise default to the first project. Derived in
  // the initializer so no state is set from within an effect.
  const [selectedProjectId, setSelectedProjectId] = useState<string>(() => {
    const pid = (searchParams.get('project_id') || '').trim();
    if (pid && projects.some((p) => p.id === pid)) return pid;
    return projects[0]?.id ?? '';
  });

  const callbackHandled = useRef(false);

  // Capture the GitHub callback outcome ONCE (before the effect below strips the
  // params) so the card can seed a `needs_install` state the backend can't report
  // on a plain load. Read in a lazy initializer → no state-set-from-effect.
  const [initialGithub] = useState<{ github: string; projectId: string } | null>(() => {
    const g = (searchParams.get('github') || '').trim();
    if (!g) return null;
    return { github: g, projectId: (searchParams.get('project_id') || '').trim() };
  });

  /* ── Connector callback receiver ─────────────────────────────────────────
   * Both backends redirect the browser (a full page load) here:
   *   Gmail:  `?gmail=connected|error&project_id=...&reason=...`
   *   GitHub: `?github=authorized|needs_install|error&project_id=...&reason=...`
   * The cards fetch real status on mount (GitHub then shows its account/repo
   * picker for a verified pending install), so here we only surface ONE toast for
   * the outcome and strip the temporary params so a refresh can't replay it.
   * Nothing is trusted for connection truth from the URL, and we never redirect
   * based on a URL value — no open-redirect surface. */
  useEffect(() => {
    if (callbackHandled.current) return;
    const gmail = searchParams.get('gmail');
    const github = searchParams.get('github');
    if (!gmail && !github) return;
    callbackHandled.current = true;

    const reasonCode = (searchParams.get('reason') || '').trim();
    const pretty = reasonCode ? ` (${reasonCode.replace(/_/g, ' ')})` : '';
    if (gmail === 'connected') {
      notify('Gmail connected successfully.', 'success');
    } else if (gmail) {
      notify(`Gmail could not be connected${pretty}.`, 'error');
    }
    // `installed` kept for backward compatibility with any in-flight redirect.
    if (github === 'authorized' || github === 'installed') {
      notify('GitHub authorized — choose a repository to connect.', 'success');
    } else if (github === 'needs_install') {
      notify('Almost there — install Korvix on GitHub to finish connecting.', 'info');
    } else if (github) {
      notify(`GitHub could not be connected${pretty}.`, 'error');
    }

    const next = new URLSearchParams(searchParams);
    for (const k of ['gmail', 'github', 'project_id', 'reason', 'state', 'setup_action', 'installation_id', 'code']) next.delete(k);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, notify]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-foreground">
      <Navbar />
      <div className="px-4 sm:px-6 py-8">
        <div className="max-w-3xl mx-auto">
          {/* Back + heading */}
          <Link to="/chat" className="inline-flex items-center gap-1.5 text-[13px] text-white/45 hover:text-white/80 transition-colors">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <div className="mt-4 mb-6">
            <h1 className="text-[22px] sm:text-[26px] font-semibold text-white tracking-tight">Connectors</h1>
            <p className="mt-1 text-[13.5px] text-white/45">
              Connect the tools Korvix uses to understand your project. Every connection is read-only and scoped to one project.
            </p>
          </div>

          {projects.length === 0 ? (
            /* Empty state — no projects to scope a connector to. */
            <motion.div
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl p-8 text-center"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div className="mx-auto h-11 w-11 rounded-xl flex items-center justify-center mb-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <FolderOpen className="h-5 w-5 text-white/40" />
              </div>
              <h3 className="text-[15px] font-semibold text-white">No projects yet</h3>
              <p className="mt-1 text-[13px] text-white/45 max-w-sm mx-auto">
                Connectors attach to a project. Create your first project, then come back to connect Gmail or GitHub to it.
              </p>
              <Link to="/projects" className={`${btnPrimary} mt-4`}>
                <FolderOpen className="h-4 w-4" /> Go to Projects
              </Link>
            </motion.div>
          ) : (
            <>
              {/* Project selector — connector authority is project-scoped. */}
              <div className="mb-5">
                <label htmlFor="connector-project" className="block text-[11px] font-medium uppercase tracking-wider text-white/35 mb-1.5">
                  Project
                </label>
                <div className="relative max-w-md">
                  <select
                    id="connector-project"
                    value={selectedProjectId}
                    onChange={(e) => setSelectedProjectId(e.target.value)}
                    className="w-full h-10 rounded-lg bg-white/[0.03] border border-white/10 px-3 pr-9 text-[13px] text-white outline-none focus:border-[#3B82F6]/40 transition-colors appearance-none"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id} className="bg-[#0a0a0f] text-white">
                        {p.name || 'Untitled project'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Connector cards. `key` on the project id remounts the cards on a
                  project switch so each reloads its own status cleanly. */}
              {selectedProject && (
                <div className="space-y-4" key={selectedProject.id}>
                  <GmailCard projectId={selectedProject.id} notify={notify} />
                  <GithubCard
                    projectId={selectedProject.id}
                    notify={notify}
                    initialGithub={
                      initialGithub && initialGithub.projectId === selectedProject.id
                        ? initialGithub.github
                        : undefined
                    }
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <ToastNotifications toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
