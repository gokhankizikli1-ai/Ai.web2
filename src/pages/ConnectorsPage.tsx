import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowLeft, RefreshCw, Loader2, CheckCircle2, AlertTriangle, FolderOpen } from 'lucide-react';
import Navbar from '@/sections/Navbar';
import ToastNotifications from '@/components/ToastNotifications';
import { useToast } from '@/hooks/useToast';
import { getProjects } from '@/stores/projectStore';
import { resolveBackTarget } from '@/lib/shellNavigation';
import type { Project } from '@/types/projects';
import {
  GmailLogo, GithubLogo, VercelLogo, GoogleCalendarLogo, SlackLogo,
} from '@/components/connectors/BrandLogos';
import ConnectorSelect from '@/components/connectors/ConnectorSelect';
import ConnectorMultiSelect from '@/components/connectors/ConnectorMultiSelect';
import {
  beginGmailConnectRedirect, getGmailConnection, syncGmail, disconnectGmail,
  type GmailConnectionView,
} from '@/lib/gmailConnectorApi';
import {
  beginCalendarConnectRedirect, getCalendarConnection, syncCalendar,
  disconnectCalendar, type CalendarConnectionView,
} from '@/lib/calendarConnectorApi';
import {
  beginGithubConnectRedirect, beginGithubInstallRedirect, getGithubConnection,
  getGithubPendingInstallations, getGithubPendingRepositories,
  selectGithubRepository, syncGithub, disconnectGithub,
  type GithubConnectionView, type GithubRepo, type GithubPendingInstallation,
} from '@/lib/githubConnectorApi';
import {
  beginVercelConnectRedirect, getVercelConnection, getVercelPendingProjects,
  selectVercelProject, syncVercel, disconnectVercel,
  type VercelConnectionView, type VercelPendingProject,
} from '@/lib/vercelConnectorApi';
import {
  beginSlackConnectRedirect, getSlackConnection, getSlackPendingChannels,
  selectSlackChannels, syncSlack, disconnectSlack,
  type SlackConnectionView, type SlackPendingChannel,
} from '@/lib/slackConnectorApi';

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

/* Standardized, TRUTHFUL sync summary shared by every connector:
 *   "12 new · 40 already known"  and, when a source failed partway,
 *   "… · 1 source had errors" with an 'info' (not 'success') tone so a partial
 * sync never reads as a clean success. Every report shape exposes the same
 * recorded/deduplicated/errors/ok fields, so one helper serves them all.
 *
 * `truncated` (currently reported by Slack) is a configured BOUND, not a
 * failure — the read stopped at a cap rather than breaking. It is still stated
 * out loud rather than hidden, because a silent cap reads as "we ingested
 * everything" when we did not; it does NOT downgrade the success tone. */
function summarizeSync(s: {
  recorded: number; deduplicated: number; errors?: Record<string, string>;
  ok: boolean; truncated?: boolean;
}): { text: string; tone: 'success' | 'info' } {
  const errCount = s.errors ? Object.keys(s.errors).length : 0;
  let text = `${s.recorded} new · ${s.deduplicated} already known`;
  if (s.truncated) text += ' · bounded read limit reached';
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
   GOOGLE CALENDAR CARD — real OAuth flow via calendarConnectorApi.
   Same shape as the Gmail card (both are single-step Google OAuth connections:
   consent, then the project is connected — there is nothing further to pick),
   so it reuses the identical states, controls and status vocabulary rather than
   inventing a second pattern.
   ══════════════════════════════════════════════════════════════════════════ */
function CalendarCard({ projectId, notify }: { projectId: string; notify: Notify }) {
  const [status, setStatus] = useState<Loaded<CalendarConnectionView>>({ state: 'loading' });
  const [busy, setBusy] = useState<null | 'connect' | 'sync' | 'disconnect'>(null);

  // `load` is await-first: it performs no synchronous setState, so the mount
  // effect that calls it never sets state during render.
  const load = useCallback(async () => {
    const res = await getCalendarConnection(projectId);
    if (res.ok) setStatus({ state: 'ready', connection: res.data.connected ? res.data.connection : null });
    else setStatus({ state: 'error', message: reason(res.status, res.message) });
  }, [projectId]);

  // Load real backend status once on mount (and on project switch, via the
  // card's key-based remount). Same await-first pattern as the other cards.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const onRetry = () => { setStatus({ state: 'loading' }); void load(); };

  const onConnect = async () => {
    setBusy('connect');
    // Starts the real backend OAuth flow and redirects the browser to Google
    // when it succeeds; only surfaces a toast if the START call fails (no
    // navigation happened, so re-enable the button).
    const res = await beginCalendarConnectRedirect(projectId);
    if (!res.ok) { notify(reason(res.status, res.message), 'error'); setBusy(null); }
  };

  const onSync = async () => {
    setBusy('sync');
    const res = await syncCalendar(projectId);
    setBusy(null);
    if (!res.ok) { notify(reason(res.status, res.message), 'error'); return; }
    const { text, tone } = summarizeSync(res.data.sync);
    notify(`Google Calendar synced — ${text}.`, tone);
    void load();
  };

  const onDisconnect = async () => {
    setBusy('disconnect');
    const res = await disconnectCalendar(projectId);
    setBusy(null);
    if (!res.ok) { notify(reason(res.status, res.message), 'error'); return; }
    // Truthful about what actually happened: when another Google connector
    // (Gmail) still shares the same Google grant, Korvix removes its own copy
    // of the credentials but deliberately does NOT revoke at Google — saying
    // "revoked" there would be a lie that also implies Gmail broke.
    notify(
      res.data.revoked_remotely
        ? 'Google Calendar disconnected and access revoked at Google.'
        : 'Google Calendar disconnected. Korvix no longer has access to your calendar.',
      'success',
    );
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
      logo={<GoogleCalendarLogo size={26} />}
      name="Google Calendar"
      description="Upcoming meetings, recent events and cancellations for your project — turned into project observations Korvix can reason over. Read-only: Korvix can never create, move, edit, or delete an event."
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
        <div className="space-y-2">
          <button className={btnPrimary} disabled={busy === 'connect'} onClick={onConnect}>
            {busy === 'connect' ? <BusySpinner /> : null} Connect Google Calendar
          </button>
          <p className="text-[11.5px] text-white/30 leading-relaxed">
            Opens Google to authorize Korvix to <span className="text-white/50">view events</span> on your
            calendar. Connecting here does not change your Gmail connection.
          </p>
        </div>
      )}

      {status.state === 'ready' && revoked && (
        <div className="flex flex-wrap items-center gap-2">
          <button className={btnPrimary} disabled={busy === 'connect'} onClick={onConnect}>
            {busy === 'connect' ? <BusySpinner /> : null} Reconnect Google Calendar
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
            {conn.time_zone && <span className="text-white/35"> · {conn.time_zone}</span>}
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
          <p className="text-[11.5px] text-white/30 leading-relaxed">
            Syncing imports upcoming and recent events for this project only. To remove Korvix's
            access to your Google account entirely, also remove it in your{' '}
            <span className="text-white/50">Google Account → Security → Third-party access</span>.
          </p>
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
          <ConnectorSelect
            ariaLabel="GitHub account"
            value={selectedInstall || status.installations[0].installation_id}
            onChange={setSelectedInstall}
            disabled={busy !== null}
            options={status.installations.map((i) => ({
              value: i.installation_id,
              label: i.account_login || `Installation ${i.installation_id}`,
              hint: i.account_type || undefined,
            }))}
          />
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
              <ConnectorSelect
                ariaLabel="Repository"
                value={selectedRepo || status.repos[0].full_name}
                onChange={setSelectedRepo}
                disabled={busy !== null}
                options={status.repos.map((r) => ({
                  value: r.full_name,
                  label: r.full_name,
                  hint: r.private ? 'private' : undefined,
                }))}
              />
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
   VERCEL CARD — real integration flow via vercelConnectorApi.
   Connect starts a Vercel integration authorization; the callback stores the
   authorization server-side and leaves the connection awaiting a PROJECT
   choice (a Vercel account routinely holds many projects, so nothing is
   auto-bound). The user then picks one from the server-provided list — the
   frontend never types or invents a Vercel project id, and the backend
   re-verifies the choice against Vercel before binding it.
   ══════════════════════════════════════════════════════════════════════════ */
/* Vercel connect-flow state.
 *   disconnected   = no authorization → show Connect.
 *   revoked        = the stored token was rejected → Reconnect / Remove.
 *   choose_project = authorized, no Vercel project bound yet → project picker.
 *   connected      = a Vercel project is bound. */
type VcState =
  | { state: 'loading' }
  /* `canRemove` marks the errors we hit AFTER confirming an authorization
   * exists (e.g. Vercel is unreachable while listing projects), so the user is
   * never stranded with a dangling authorization and no way to clear it. */
  | { state: 'error'; message: string; canRemove?: boolean }
  | { state: 'disconnected' }
  | { state: 'revoked' }
  | { state: 'choose_project'; projects: VercelPendingProject[] }
  | { state: 'connected'; connection: VercelConnectionView };

function VercelCard({ projectId, notify }: { projectId: string; notify: Notify }) {
  const [status, setStatus] = useState<VcState>({ state: 'loading' });
  const [busy, setBusy] = useState<null | 'connect' | 'select' | 'change' | 'sync' | 'disconnect'>(null);
  const [selectedProject, setSelectedProject] = useState('');

  // Resolve the Vercel projects this authorization can bind → the picker.
  // `refresh` forces a live re-read (the "change project" path).
  const loadProjectsFor = useCallback(async (refresh: boolean): Promise<boolean> => {
    const res = await getVercelPendingProjects(projectId, refresh);
    if (res.ok) {
      setStatus({ state: 'choose_project', projects: res.data.projects });
      return true;
    }
    return false;
  }, [projectId]);

  // `load` is await-first: it performs no synchronous setState, so the mount
  // effect that calls it never sets state during render.
  const load = useCallback(async () => {
    const res = await getVercelConnection(projectId);
    if (!res.ok) { setStatus({ state: 'error', message: reason(res.status, res.message) }); return; }
    const conn = res.data.connection;
    if (!conn) { setStatus({ state: 'disconnected' }); return; }
    if (conn.status === 'revoked') { setStatus({ state: 'revoked' }); return; }
    if (res.data.connected) { setStatus({ state: 'connected', connection: conn }); return; }
    // Authorized but no Vercel project chosen yet. If Vercel can't be reached to
    // list them, say so honestly (never an empty "no projects") and still offer
    // a way out of the half-finished connection.
    if (await loadProjectsFor(false)) return;
    setStatus({
      state: 'error', canRemove: true,
      message: 'Vercel is authorized, but its projects could not be listed right now.',
    });
  }, [projectId, loadProjectsFor]);

  // Load real backend status once on mount (and on project switch, via the
  // card's key-based remount). Same await-first pattern as the other cards.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const onRetry = () => { setStatus({ state: 'loading' }); void load(); };

  const onConnect = async () => {
    setBusy('connect');
    // Starts the real backend flow and redirects the browser to Vercel when it
    // succeeds; only surfaces a toast if the START call fails (no navigation
    // happened, so re-enable the button).
    const res = await beginVercelConnectRedirect(projectId);
    if (!res.ok) { notify(reason(res.status, res.message), 'error'); setBusy(null); }
  };

  const onSelect = async (projects: VercelPendingProject[]) => {
    const chosen = selectedProject || projects[0]?.vercel_project_id || '';
    if (!chosen) { notify('Choose a Vercel project to connect.', 'error'); return; }
    setBusy('select');
    const res = await selectVercelProject(projectId, chosen);
    setBusy(null);
    if (!res.ok) { notify(reason(res.status, res.message), 'error'); return; }
    notify(`Vercel connected — ${res.data.connection.vercel_project_name || chosen}.`, 'success');
    void load();
  };

  // "Change project" reuses the SAME server-authoritative selection flow.
  const onChangeProject = async () => {
    setBusy('change');
    const ok = await loadProjectsFor(true);
    setBusy(null);
    if (!ok) notify('Could not list your Vercel projects.', 'error');
  };

  const onSync = async () => {
    setBusy('sync');
    const res = await syncVercel(projectId);
    setBusy(null);
    if (!res.ok) { notify(reason(res.status, res.message), 'error'); return; }
    const { text, tone } = summarizeSync(res.data.sync);
    notify(`Vercel synced — ${text}.`, tone);
    void load();
  };

  const onDisconnect = async () => {
    setBusy('disconnect');
    const res = await disconnectVercel(projectId);
    setBusy(null);
    if (!res.ok) { notify(reason(res.status, res.message), 'error'); return; }
    notify('Vercel disconnected.', 'success');
    void load();
  };

  let pill: React.ReactNode = null;
  if (status.state === 'connected') pill = <StatusPill tone="connected" label="Connected" />;
  else if (status.state === 'choose_project') pill = <StatusPill tone="revoked" label="Choose a project" />;
  else if (status.state === 'revoked') pill = <StatusPill tone="revoked" label="Reconnect needed" />;
  else if (status.state === 'disconnected') pill = <StatusPill tone="muted" label="Not connected" />;

  return (
    <ConnectorShell
      logo={<VercelLogo size={22} className="text-white" />}
      name="Vercel"
      description="Deployment status for your live product — production and preview builds, successes and failures — turned into project observations. Read-only: Korvix can never deploy, roll back, change environment variables, or delete anything."
      statusPill={pill}
    >
      {status.state === 'loading' && (
        <div className="flex items-center gap-2 text-[13px] text-white/40"><BusySpinner /> Checking status…</div>
      )}

      {status.state === 'error' && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[13px] text-[#F87171]/90">{status.message}</span>
          <div className="flex items-center gap-2">
            <button className={btnGhost} onClick={onRetry}><RefreshCw className="h-3.5 w-3.5" /> Retry</button>
            {status.canRemove && (
              <button className={btnDanger} disabled={busy === 'disconnect'} onClick={onDisconnect}>
                {busy === 'disconnect' ? <BusySpinner /> : null} Remove
              </button>
            )}
          </div>
        </div>
      )}

      {status.state === 'disconnected' && (
        <div className="space-y-2">
          <button className={btnPrimary} disabled={busy === 'connect'} onClick={onConnect}>
            {busy === 'connect' ? <BusySpinner /> : null} Connect Vercel
          </button>
          <p className="text-[11.5px] text-white/30 leading-relaxed">
            Opens Vercel to authorize Korvix. You choose the account or team and which projects
            Korvix may see, then pick the one that belongs to this project here.
          </p>
        </div>
      )}

      {status.state === 'revoked' && (
        <div className="flex flex-wrap items-center gap-2">
          <button className={btnPrimary} disabled={busy === 'connect'} onClick={onConnect}>
            {busy === 'connect' ? <BusySpinner /> : null} Reconnect Vercel
          </button>
          <button className={btnDanger} disabled={busy === 'disconnect'} onClick={onDisconnect}>
            {busy === 'disconnect' ? <BusySpinner /> : null} Remove
          </button>
        </div>
      )}

      {status.state === 'choose_project' && (
        <div className="space-y-3 max-w-md">
          {status.projects.length > 0 ? (
            <>
              <div className="text-[12.5px] text-white/45">Vercel authorized. Choose the project to connect:</div>
              <ConnectorSelect
                ariaLabel="Vercel project"
                value={selectedProject || status.projects[0].vercel_project_id}
                onChange={setSelectedProject}
                disabled={busy !== null}
                options={status.projects.map((p) => ({
                  value: p.vercel_project_id,
                  label: p.name || p.vercel_project_id,
                  hint: p.framework || undefined,
                }))}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button className={btnPrimary} disabled={busy === 'select'} onClick={() => onSelect(status.projects)}>
                  {busy === 'select' ? <BusySpinner /> : null} Connect project
                </button>
                <button className={btnGhost} disabled={busy === 'change'} onClick={onChangeProject}>
                  {busy === 'change' ? <BusySpinner /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh list
                </button>
                <button className={btnDanger} disabled={busy === 'disconnect'} onClick={onDisconnect}>
                  {busy === 'disconnect' ? <BusySpinner /> : null} Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <div className="text-[13px] text-white/55">
                Korvix is authorized, but this Vercel account has no projects it can see.
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button className={btnGhost} disabled={busy === 'change'} onClick={onChangeProject}>
                  {busy === 'change' ? <BusySpinner /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh list
                </button>
                <button className={btnDanger} disabled={busy === 'disconnect'} onClick={onDisconnect}>
                  {busy === 'disconnect' ? <BusySpinner /> : null} Remove
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {status.state === 'connected' && (
        <div className="space-y-3">
          <div className="text-[13px] text-white/60">
            Connected to{' '}
            <span className="text-white font-medium">
              {status.connection.vercel_project_name || status.connection.vercel_project_id}
            </span>
            {status.connection.account_label && (
              <span className="text-white/35"> · {status.connection.account_label}</span>
            )}
            {status.connection.last_sync_at && (
              <span className="text-white/35"> · last sync {new Date(status.connection.last_sync_at).toLocaleString()}</span>
            )}
          </div>
          {status.connection.production_url && (
            <div className="text-[12px] text-white/35 truncate">{status.connection.production_url}</div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button className={btnGhost} disabled={busy !== null} onClick={onSync}>
              {busy === 'sync' ? <BusySpinner /> : <RefreshCw className="h-3.5 w-3.5" />} Sync now
            </button>
            <button className={btnGhost} disabled={busy !== null} onClick={onChangeProject}>
              {busy === 'change' ? <BusySpinner /> : null} Change project
            </button>
            <button className={btnDanger} disabled={busy !== null} onClick={onDisconnect}>
              {busy === 'disconnect' ? <BusySpinner /> : null} Disconnect
            </button>
          </div>
          <p className="text-[11.5px] text-white/30 leading-relaxed">
            Disconnecting removes Korvix's copy of the connection. To revoke access entirely,
            remove the Korvix integration in your Vercel dashboard.
          </p>
        </div>
      )}
    </ConnectorShell>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SLACK CARD — real Slack install flow via slackConnectorApi.
   Connect starts a Slack workspace install; the callback stores the
   installation server-side and leaves the connection awaiting a CHANNEL
   choice (a workspace routinely holds hundreds of channels, so nothing is
   auto-bound). The user then picks one or more from the server-provided list —
   the frontend never types or invents a channel id, and the backend re-verifies
   every choice against Slack (including that Korvix is actually a member)
   before binding it.
   ══════════════════════════════════════════════════════════════════════════ */
/* Slack connect-flow state.
 *   disconnected    = no installation → show Connect.
 *   revoked         = the stored token was rejected → Reconnect / Remove.
 *   choose_channels = installed, no channels bound yet → channel picker.
 *   connected       = at least one channel is bound. */
type SlState =
  | { state: 'loading' }
  /* `canRemove` marks the errors we hit AFTER confirming an installation
   * exists (e.g. Slack is unreachable while listing channels), so the user is
   * never stranded with a dangling installation and no way to clear it. */
  | { state: 'error'; message: string; canRemove?: boolean }
  | { state: 'disconnected' }
  | { state: 'revoked' }
  | { state: 'choose_channels'; channels: SlackPendingChannel[]; maxSelected: number }
  | { state: 'connected'; connection: SlackConnectionView };

function SlackCard({ projectId, notify }: { projectId: string; notify: Notify }) {
  const [status, setStatus] = useState<SlState>({ state: 'loading' });
  const [busy, setBusy] = useState<null | 'connect' | 'select' | 'change' | 'sync' | 'disconnect'>(null);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);

  // Resolve the channels this installation can see → the picker. `refresh`
  // forces a live re-read (the "change channels" path).
  const loadChannelsFor = useCallback(async (refresh: boolean): Promise<boolean> => {
    const res = await getSlackPendingChannels(projectId, refresh);
    if (res.ok) {
      setStatus({
        state: 'choose_channels',
        channels: res.data.channels,
        maxSelected: res.data.max_selected,
      });
      return true;
    }
    return false;
  }, [projectId]);

  // `load` is await-first: it performs no synchronous setState, so the mount
  // effect that calls it never sets state during render.
  const load = useCallback(async () => {
    const res = await getSlackConnection(projectId);
    if (!res.ok) { setStatus({ state: 'error', message: reason(res.status, res.message) }); return; }
    const conn = res.data.connection;
    if (!conn) { setStatus({ state: 'disconnected' }); return; }
    // `owner_mismatch` means a stale connection row exists whose stored owner is
    // no longer this project's owner. The backend redacts its workspace details
    // (there is nothing left to display), and the fix is exactly the revoked
    // path: Reconnect re-installs under the current owner, Remove clears the row.
    if (conn.status === 'revoked' || conn.status === 'owner_mismatch') {
      setStatus({ state: 'revoked' }); return;
    }
    if (res.data.connected) { setStatus({ state: 'connected', connection: conn }); return; }
    // Installed but no channels chosen yet. If Slack can't be reached to list
    // them, say so honestly (never an empty "no channels") and still offer a way
    // out of the half-finished connection.
    if (await loadChannelsFor(false)) return;
    setStatus({
      state: 'error', canRemove: true,
      message: 'Slack is connected, but its channels could not be listed right now.',
    });
  }, [projectId, loadChannelsFor]);

  // Load real backend status once on mount (and on project switch, via the
  // card's key-based remount). Same await-first pattern as the other cards.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const onRetry = () => { setStatus({ state: 'loading' }); void load(); };

  const onConnect = async () => {
    setBusy('connect');
    // Starts the real backend flow and redirects the browser to Slack when it
    // succeeds; only surfaces a toast if the START call fails (no navigation
    // happened, so re-enable the button).
    const res = await beginSlackConnectRedirect(projectId);
    if (!res.ok) { notify(reason(res.status, res.message), 'error'); setBusy(null); }
  };

  const onSelect = async () => {
    if (selectedChannels.length === 0) { notify('Choose at least one channel.', 'error'); return; }
    setBusy('select');
    const res = await selectSlackChannels(projectId, selectedChannels);
    setBusy(null);
    if (!res.ok) { notify(reason(res.status, res.message), 'error'); return; }
    const count = res.data.connection.channel_count;
    notify(`Slack connected — ${count} channel${count === 1 ? '' : 's'}.`, 'success');
    setSelectedChannels([]);
    void load();
  };

  // "Change channels" reuses the SAME server-authoritative selection flow, and
  // pre-selects what is already bound so the picker starts from today's truth.
  const onChangeChannels = async (current: SlackConnectionView | null) => {
    setBusy('change');
    setSelectedChannels(current ? current.channels.map((c) => c.channel_id) : []);
    const ok = await loadChannelsFor(true);
    setBusy(null);
    if (!ok) notify('Could not list your Slack channels.', 'error');
  };

  const onSync = async () => {
    setBusy('sync');
    const res = await syncSlack(projectId);
    setBusy(null);
    if (!res.ok) { notify(reason(res.status, res.message), 'error'); return; }
    const { text, tone } = summarizeSync(res.data.sync);
    notify(`Slack synced — ${text}.`, tone);
    void load();
  };

  const onDisconnect = async () => {
    setBusy('disconnect');
    const res = await disconnectSlack(projectId);
    setBusy(null);
    if (!res.ok) { notify(reason(res.status, res.message), 'error'); return; }
    // Truthful about what actually happened: Slack installs an app once per
    // workspace, so removing this project's connection deliberately leaves the
    // workspace install (and any other project using it) alone.
    notify(
      res.data.workspace_still_connected
        ? 'Slack disconnected for this project. Another project still uses this workspace, so the Slack app stays installed.'
        : 'Slack disconnected. Korvix no longer reads this workspace for this project.',
      'success',
    );
    void load();
  };

  let pill: React.ReactNode = null;
  if (status.state === 'connected') pill = <StatusPill tone="connected" label="Connected" />;
  else if (status.state === 'choose_channels') pill = <StatusPill tone="revoked" label="Choose channels" />;
  else if (status.state === 'revoked') pill = <StatusPill tone="revoked" label="Reconnect needed" />;
  else if (status.state === 'disconnected') pill = <StatusPill tone="muted" label="Not connected" />;

  return (
    <ConnectorShell
      logo={<SlackLogo size={24} />}
      name="Slack"
      description="Recent conversation in the channels you choose — decisions, blockers and threads — turned into project observations Korvix can reason over. Read-only: Korvix can never send, edit, or delete a message, and never joins a channel by itself."
      statusPill={pill}
    >
      {status.state === 'loading' && (
        <div className="flex items-center gap-2 text-[13px] text-white/40"><BusySpinner /> Checking status…</div>
      )}

      {status.state === 'error' && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[13px] text-[#F87171]/90">{status.message}</span>
          <div className="flex items-center gap-2">
            <button className={btnGhost} onClick={onRetry}><RefreshCw className="h-3.5 w-3.5" /> Retry</button>
            {status.canRemove && (
              <button className={btnDanger} disabled={busy === 'disconnect'} onClick={onDisconnect}>
                {busy === 'disconnect' ? <BusySpinner /> : null} Remove
              </button>
            )}
          </div>
        </div>
      )}

      {status.state === 'disconnected' && (
        <div className="space-y-2">
          <button className={btnPrimary} disabled={busy === 'connect'} onClick={onConnect}>
            {busy === 'connect' ? <BusySpinner /> : null} Connect Slack
          </button>
          <p className="text-[11.5px] text-white/30 leading-relaxed">
            Opens Slack to add Korvix to your workspace. You then choose which channels belong to
            this project — Korvix only reads the channels it has been{' '}
            <span className="text-white/50">invited to</span>.
          </p>
        </div>
      )}

      {status.state === 'revoked' && (
        <div className="flex flex-wrap items-center gap-2">
          <button className={btnPrimary} disabled={busy === 'connect'} onClick={onConnect}>
            {busy === 'connect' ? <BusySpinner /> : null} Reconnect Slack
          </button>
          <button className={btnDanger} disabled={busy === 'disconnect'} onClick={onDisconnect}>
            {busy === 'disconnect' ? <BusySpinner /> : null} Remove
          </button>
        </div>
      )}

      {status.state === 'choose_channels' && (
        <div className="space-y-3 max-w-md">
          {status.channels.length > 0 ? (
            <>
              <div className="text-[12.5px] text-white/45">
                Slack connected. Choose the channels that belong to this project:
              </div>
              <ConnectorMultiSelect
                ariaLabel="Slack channels"
                max={status.maxSelected}
                selected={selectedChannels}
                onChange={setSelectedChannels}
                disabled={busy !== null}
                options={status.channels.map((c) => ({
                  value: c.channel_id,
                  label: c.name ? `#${c.name}` : c.channel_id,
                  hint: c.is_private ? 'private' : undefined,
                  // Slack's own truth: a bot can only read a channel it is in.
                  disabled: !c.is_member,
                  disabledReason: !c.is_member ? 'invite Korvix' : undefined,
                }))}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button className={btnPrimary} disabled={busy === 'select'} onClick={onSelect}>
                  {busy === 'select' ? <BusySpinner /> : null} Connect channels
                </button>
                <button className={btnGhost} disabled={busy === 'change'} onClick={() => onChangeChannels(null)}>
                  {busy === 'change' ? <BusySpinner /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh list
                </button>
                <button className={btnDanger} disabled={busy === 'disconnect'} onClick={onDisconnect}>
                  {busy === 'disconnect' ? <BusySpinner /> : null} Cancel
                </button>
              </div>
              <p className="text-[11.5px] text-white/30 leading-relaxed">
                Greyed-out channels are ones Korvix has not been invited to yet. Type{' '}
                <span className="text-white/50">/invite @Korvix AI</span> in that channel in Slack,
                then refresh this list.
              </p>
            </>
          ) : (
            <div className="space-y-2">
              <div className="text-[13px] text-white/55">
                Korvix is installed, but it cannot see any channels in this workspace yet.
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button className={btnGhost} disabled={busy === 'change'} onClick={() => onChangeChannels(null)}>
                  {busy === 'change' ? <BusySpinner /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh list
                </button>
                <button className={btnDanger} disabled={busy === 'disconnect'} onClick={onDisconnect}>
                  {busy === 'disconnect' ? <BusySpinner /> : null} Remove
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {status.state === 'connected' && (
        <div className="space-y-3">
          <div className="text-[13px] text-white/60">
            Connected to{' '}
            <span className="text-white font-medium">
              {status.connection.team_name || status.connection.team_id}
            </span>
            {status.connection.last_sync_at && (
              <span className="text-white/35"> · last sync {new Date(status.connection.last_sync_at).toLocaleString()}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {status.connection.channels.map((c) => (
              <span
                key={c.channel_id}
                className="inline-flex items-center rounded-md border border-white/10 bg-white/[0.03] px-2 py-[3px] text-[11.5px] text-white/60"
              >
                #{c.name || c.channel_id}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className={btnGhost} disabled={busy !== null} onClick={onSync}>
              {busy === 'sync' ? <BusySpinner /> : <RefreshCw className="h-3.5 w-3.5" />} Sync now
            </button>
            <button className={btnGhost} disabled={busy !== null} onClick={() => onChangeChannels(status.connection)}>
              {busy === 'change' ? <BusySpinner /> : null} Change channels
            </button>
            <button className={btnDanger} disabled={busy !== null} onClick={onDisconnect}>
              {busy === 'disconnect' ? <BusySpinner /> : null} Disconnect
            </button>
          </div>
          <p className="text-[11.5px] text-white/30 leading-relaxed">
            Syncing imports recent messages from these channels only, for this project only.
            Disconnecting removes Korvix's copy of the connection; to remove the app from your
            workspace entirely, do it in <span className="text-white/50">Slack → Manage apps</span>.
          </p>
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
  const navigate = useNavigate();
  const location = useLocation();

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
   * Each backend redirects the browser (a full page load) here:
   *   Gmail:    `?gmail=connected|error&project_id=...&reason=...`
   *   Calendar: `?calendar=connected|error&project_id=...&reason=...`
   *   GitHub:   `?github=authorized|needs_install|error&project_id=...&reason=...`
   *   Vercel:   `?vercel=authorized|error&project_id=...&reason=...`
   *   Slack:    `?slack=authorized|error&project_id=...&reason=...`
   * The cards fetch real status on mount (GitHub then shows its account/repo
   * picker for a verified pending install; Vercel shows its project picker;
   * Slack shows its channel picker), so here we only surface ONE toast for the
   * outcome and strip the temporary params so a refresh can't replay it. Nothing
   * is trusted for connection truth from the URL, and we never redirect based on
   * a URL value — no open-redirect surface. */
  useEffect(() => {
    if (callbackHandled.current) return;
    const gmail = searchParams.get('gmail');
    const calendar = searchParams.get('calendar');
    const github = searchParams.get('github');
    const vercel = searchParams.get('vercel');
    const slack = searchParams.get('slack');
    if (!gmail && !calendar && !github && !vercel && !slack) return;
    callbackHandled.current = true;

    const reasonCode = (searchParams.get('reason') || '').trim();
    const pretty = reasonCode ? ` (${reasonCode.replace(/_/g, ' ')})` : '';
    if (gmail === 'connected') {
      notify('Gmail connected successfully.', 'success');
    } else if (gmail) {
      notify(`Gmail could not be connected${pretty}.`, 'error');
    }
    if (calendar === 'connected') {
      notify('Google Calendar connected successfully.', 'success');
    } else if (calendar) {
      notify(`Google Calendar could not be connected${pretty}.`, 'error');
    }
    // `installed` kept for backward compatibility with any in-flight redirect.
    if (github === 'authorized' || github === 'installed') {
      notify('GitHub authorized — choose a repository to connect.', 'success');
    } else if (github === 'needs_install') {
      notify('Almost there — install Korvix on GitHub to finish connecting.', 'info');
    } else if (github) {
      notify(`GitHub could not be connected${pretty}.`, 'error');
    }
    if (vercel === 'authorized') {
      notify('Vercel authorized — choose a project to connect.', 'success');
    } else if (vercel) {
      notify(`Vercel could not be connected${pretty}.`, 'error');
    }
    if (slack === 'authorized') {
      notify('Slack connected — choose the channels for this project.', 'success');
    } else if (slack) {
      notify(`Slack could not be connected${pretty}.`, 'error');
    }

    const next = new URLSearchParams(searchParams);
    for (const k of ['gmail', 'calendar', 'github', 'vercel', 'slack', 'project_id', 'reason', 'state',
                     'setup_action', 'installation_id', 'configurationId', 'teamId',
                     'next', 'code']) next.delete(k);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, notify]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-foreground">
      {/* `surface="dark"` matches the other dark pages that host this shared
          navbar (About, Legal); the default light surface renders slate text on
          this near-black page. */}
      <Navbar surface="dark" variant="app" />
      {/* `pt-24` clears the FIXED h-14 navbar, matching every other page that
          renders it (SettingsPage pt-24; About/Legal/Features/Pricing pt-28).
          With the previous `py-8` the Back control sat at y≈32px — underneath
          the navbar's full-width fixed header — so clicks hit the navbar and
          never reached the link. That, not the route, is why Back appeared
          dead. */}
      <div className="px-4 sm:px-6 pt-24 pb-12">
        <div className="max-w-3xl mx-auto">
          {/* Back + heading */}
          <button
            type="button"
            onClick={goBack}
            className="inline-flex items-center gap-1.5 text-[13px] text-white/45 hover:text-white/80 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
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
                Connectors attach to a project. Create your first project, then come back to connect Gmail, Google Calendar, GitHub, Vercel or Slack to it.
              </p>
              <Link to="/projects" className={`${btnPrimary} mt-4`}>
                <FolderOpen className="h-4 w-4" /> Go to Projects
              </Link>
            </motion.div>
          ) : (
            <>
              {/* Project selector — connector authority is project-scoped. The
                  heading is presentational (the control is a Radix button, not
                  an <input>, so it carries its own accessible name via
                  `ariaLabel` rather than a `htmlFor` pairing). */}
              <div className="mb-5">
                <div className="block text-[11px] font-medium uppercase tracking-wider text-white/35 mb-1.5">
                  Project
                </div>
                <div className="max-w-md">
                  <ConnectorSelect
                    ariaLabel="Project"
                    value={selectedProjectId}
                    onChange={setSelectedProjectId}
                    options={projects.map((p) => ({
                      value: p.id,
                      label: p.name || 'Untitled project',
                    }))}
                  />
                </div>
              </div>

              {/* Connector cards. `key` on the project id remounts the cards on a
                  project switch so each reloads its own status cleanly. */}
              {selectedProject && (
                <div className="space-y-4" key={selectedProject.id}>
                  <GmailCard projectId={selectedProject.id} notify={notify} />
                  <CalendarCard projectId={selectedProject.id} notify={notify} />
                  <GithubCard
                    projectId={selectedProject.id}
                    notify={notify}
                    initialGithub={
                      initialGithub && initialGithub.projectId === selectedProject.id
                        ? initialGithub.github
                        : undefined
                    }
                  />
                  <VercelCard projectId={selectedProject.id} notify={notify} />
                  <SlackCard projectId={selectedProject.id} notify={notify} />
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
