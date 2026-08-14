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
  connectGithub, getGithubConnection, syncGithub, disconnectGithub,
  type GithubConnectionView,
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
    const s = res.data.sync;
    notify(`Gmail synced — ${s.recorded} new, ${s.deduplicated} already known.`, s.ok ? 'success' : 'info');
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
            <button className={btnGhost} disabled={busy === 'sync'} onClick={onSync}>
              {busy === 'sync' ? <BusySpinner /> : <RefreshCw className="h-3.5 w-3.5" />} Sync now
            </button>
            <button className={btnDanger} disabled={busy === 'disconnect'} onClick={onDisconnect}>
              {busy === 'disconnect' ? <BusySpinner /> : null} Disconnect
            </button>
          </div>
        </div>
      )}
    </ConnectorShell>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   GITHUB CARD — real GitHub App install flow via githubConnectorApi.
   The backend contract links a repo (owner/repo) + App installation to the
   project; it is NOT a browser OAuth redirect, so connecting uses a small form.
   ══════════════════════════════════════════════════════════════════════════ */
function GithubCard({ projectId, notify }: { projectId: string; notify: Notify }) {
  const [status, setStatus] = useState<Loaded<GithubConnectionView>>({ state: 'loading' });
  const [busy, setBusy] = useState<null | 'connect' | 'sync' | 'disconnect'>(null);
  const [repo, setRepo] = useState('');
  const [installationId, setInstallationId] = useState('');

  const load = useCallback(async () => {
    const res = await getGithubConnection(projectId);
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

  const trimmedRepo = repo.trim().replace(/^\/+|\/+$/g, '');
  const repoValid = trimmedRepo.split('/').filter(Boolean).length === 2 && trimmedRepo.indexOf('/') === trimmedRepo.lastIndexOf('/');

  const onConnect = async () => {
    if (!repoValid) { notify('Enter the repository as "owner/repo".', 'error'); return; }
    setBusy('connect');
    const res = await connectGithub(projectId, {
      repoFullName: trimmedRepo,
      installationId: installationId.trim() || undefined,
    });
    setBusy(null);
    if (!res.ok) { notify(reason(res.status, res.message), 'error'); return; }
    notify(`GitHub connected — ${res.data.connection.repo_full_name}.`, 'success');
    setRepo(''); setInstallationId('');
    void load();
  };

  const onSync = async () => {
    setBusy('sync');
    const res = await syncGithub(projectId);
    setBusy(null);
    if (!res.ok) { notify(reason(res.status, res.message), 'error'); return; }
    const s = res.data.sync;
    notify(`GitHub synced — ${s.recorded} new, ${s.deduplicated} already known.`, s.ok ? 'success' : 'info');
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

  const conn = status.state === 'ready' ? status.connection : null;
  const connected = !!conn;

  const inputCls = 'w-full h-9 rounded-lg bg-white/[0.03] border border-white/10 px-3 text-[13px] text-white placeholder:text-white/25 outline-none focus:border-[#3B82F6]/40 transition-colors';

  return (
    <ConnectorShell
      logo={<GithubLogo size={24} className="text-white" />}
      name="GitHub"
      description="Repository activity, pull requests, checks and development context — turned into project observations. Read-only: Korvix never pushes, merges, or changes your repo."
      statusPill={status.state === 'ready' ? (connected ? <StatusPill tone="connected" label="Connected" /> : <StatusPill tone="muted" label="Not connected" />) : null}
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

      {status.state === 'ready' && !connected && (
        <div className="space-y-2.5 max-w-md">
          <input
            className={inputCls}
            placeholder="owner/repo  (e.g. korvixai/website)"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            spellCheck={false}
            autoCapitalize="none"
          />
          <input
            className={inputCls}
            placeholder="GitHub App installation id (optional)"
            value={installationId}
            onChange={(e) => setInstallationId(e.target.value)}
            spellCheck={false}
            autoCapitalize="none"
            inputMode="numeric"
          />
          <div className="flex items-center gap-2">
            <button className={btnPrimary} disabled={busy === 'connect' || !repoValid} onClick={onConnect}>
              {busy === 'connect' ? <BusySpinner /> : null} Connect GitHub
            </button>
          </div>
          <p className="text-[11.5px] text-white/30 leading-relaxed">
            Requires the Korvix GitHub App to be installed on the repository. Leave the installation id
            blank to use the server default when one is configured.
          </p>
        </div>
      )}

      {status.state === 'ready' && connected && conn && (
        <div className="space-y-3">
          <div className="text-[13px] text-white/60">
            Connected to <span className="text-white font-medium">{conn.repo_full_name}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className={btnGhost} disabled={busy === 'sync'} onClick={onSync}>
              {busy === 'sync' ? <BusySpinner /> : <RefreshCw className="h-3.5 w-3.5" />} Sync now
            </button>
            <button className={btnDanger} disabled={busy === 'disconnect'} onClick={onDisconnect}>
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

  /* ── OAuth callback receiver ─────────────────────────────────────────────
   * The Gmail backend redirects the browser (a full page load) to
   * `/#/settings/integrations?gmail=connected|error&project_id=...&reason=...`.
   * The card fetches real status on mount, so here we only surface ONE toast
   * for the outcome and then strip the temporary params so a refresh can't
   * replay it. Nothing is trusted for connection truth from the URL, and we
   * never redirect based on a URL value — no open-redirect surface. */
  useEffect(() => {
    if (callbackHandled.current) return;
    const gmail = searchParams.get('gmail');
    if (!gmail) return;
    callbackHandled.current = true;

    if (gmail === 'connected') {
      notify('Gmail connected successfully.', 'success');
    } else {
      const reasonCode = (searchParams.get('reason') || '').trim();
      notify(
        reasonCode ? `Gmail could not be connected (${reasonCode.replace(/_/g, ' ')}).` : 'Gmail could not be connected.',
        'error',
      );
    }

    const next = new URLSearchParams(searchParams);
    next.delete('gmail'); next.delete('project_id'); next.delete('reason'); next.delete('state');
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
                  <GithubCard projectId={selectedProject.id} notify={notify} />
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
