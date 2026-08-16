/**
 * connectorStatus — the compact card's two lines of truth, as a pure function.
 *
 * The account-level Connectors card has room for exactly one status pill and one
 * summary line, so what goes in them has to be decided carefully rather than
 * improvised in JSX:
 *
 *   • it must never claim a connection the backend did not report;
 *   • it must distinguish "connected and working" from "connected but a project
 *     still has to choose what it may read" — the second one looks fine and
 *     silently syncs nothing, which is the worst kind of wrong;
 *   • it must describe providers honestly. Gmail binds a whole mailbox; Slack
 *     binds channels; GitHub binds repositories. A summary that says "3 channels"
 *     for Gmail is a lie the shared model would otherwise make easy.
 *
 * Keeping it here means the wording is unit-tested instead of eyeballed.
 */
import type { ConnectorSummary } from '@/lib/connectorsApi';

export type ConnectorStatusTone = 'connected' | 'attention' | 'muted';

export interface ConnectorStatus {
  tone: ConnectorStatusTone;
  label: string;
}

const PENDING = 'pending_selection';

/** How many projects use this authorization, and how many still need setup. */
export function connectorUsage(connector: ConnectorSummary): {
  projects: number; pending: number; resources: number;
} {
  const auth = connector.authorization;
  if (!auth) return { projects: 0, pending: 0, resources: 0 };
  const projects = auth.projects || [];
  return {
    projects: projects.length,
    pending: projects.filter((p) => p.status === PENDING).length,
    resources: projects.reduce((n, p) => n + (p.resource_count || 0), 0),
  };
}

export function connectorStatus(connector: ConnectorSummary): ConnectorStatus {
  if (!connector.enabled) return { tone: 'muted', label: 'Unavailable' };
  const auth = connector.authorization;
  if (!auth) return { tone: 'muted', label: 'Not connected' };
  if (!auth.authorized) return { tone: 'attention', label: 'Reconnect' };
  const { projects, pending } = connectorUsage(connector);
  // Authorized but no project uses it yet — a real, non-broken state that the
  // user still has to act on, so it is NOT shown as "Connected".
  if (projects === 0) return { tone: 'attention', label: 'Not in use' };
  if (pending > 0) return { tone: 'attention', label: 'Needs setup' };
  return { tone: 'connected', label: 'Connected' };
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The single summary line under the provider name: who is connected, and what
 * this account actually uses it for. Provider-specific by design — see the
 * module docstring.
 */
export function connectorSummaryLine(connector: ConnectorSummary): string {
  if (!connector.enabled) {
    return 'This connector is switched off on this deployment.';
  }
  const auth = connector.authorization;
  if (!auth) return 'Not connected to your account yet';
  if (!auth.authorized) {
    return `${auth.account_label || 'Authorization'} — access was revoked, reconnect to resume`;
  }

  const { projects, pending, resources } = connectorUsage(connector);
  const who = auth.account_label || 'Connected';
  const parts: string[] = [who];

  if (projects === 0) {
    parts.push('not used by any project yet');
  } else {
    parts.push(`${plural(projects, 'project')}`);
    // Only a MULTI provider reports a resource count. A SINGLE provider binds
    // exactly one resource per project, so its count would always restate the
    // project count — and for Vercel (whose resource noun is "project") it would
    // read "2 projects · 2 projects". An ACCOUNT provider has no resource at all,
    // so it must never show a count: "3 channels" under Gmail would be a lie the
    // shared model would otherwise make easy.
    if (connector.resource_kind === 'multi' && resources > 0) {
      parts.push(`${plural(resources, connector.resource_noun || 'resource')}`);
    }
    if (pending > 0) {
      parts.push(`${pending} need${pending === 1 ? 's' : ''} setup`);
    }
  }
  return parts.join(' · ');
}
