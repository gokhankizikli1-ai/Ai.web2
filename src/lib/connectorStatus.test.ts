import { describe, it, expect } from 'vitest';
import {
  connectorStatus, connectorSummaryLine, connectorUsage,
} from './connectorStatus';
import type {
  ConnectorSummary, ConnectorAuthorization, AuthorizationProjectUsage,
} from './connectorsApi';

function usage(over: Partial<AuthorizationProjectUsage> = {}): AuthorizationProjectUsage {
  return {
    project_id: 'p1', project_name: 'Project A', status: 'connected',
    resources: [], resource_count: 0, last_sync_at: null, ...over,
  };
}

function auth(over: Partial<ConnectorAuthorization> = {}): ConnectorAuthorization {
  return {
    id: 'auth_1', provider: 'gmail', account_label: 'me@x.com', scopes: [],
    status: 'authorized', authorized: true, metadata: {},
    created_at: '', updated_at: '', last_sync_at: null,
    project_count: 0, projects: [], ...over,
  };
}

function connector(over: Partial<ConnectorSummary> = {}): ConnectorSummary {
  return {
    provider: 'gmail', label: 'Gmail', resource_kind: 'account', resource_noun: '',
    requires_resource_selection: false, enabled: true, authorization: null, ...over,
  };
}

describe('connectorStatus', () => {
  it('reports a disabled deployment honestly instead of hiding the card', () => {
    const s = connectorStatus(connector({ enabled: false, authorization: auth() }));
    expect(s).toEqual({ tone: 'muted', label: 'Unavailable' });
    expect(connectorSummaryLine(connector({ enabled: false })))
      .toContain('switched off');
  });

  it('is "Not connected" with no authorization', () => {
    expect(connectorStatus(connector())).toEqual({ tone: 'muted', label: 'Not connected' });
  });

  it('flags a revoked authorization for reconnect', () => {
    const c = connector({ authorization: auth({ authorized: false, status: 'revoked' }) });
    expect(connectorStatus(c)).toEqual({ tone: 'attention', label: 'Reconnect' });
    expect(connectorSummaryLine(c)).toContain('revoked');
  });

  it('does NOT claim "Connected" when no project uses it yet', () => {
    // Authorizing exposes the provider to nothing — the card must say so rather
    // than imply data is flowing.
    const c = connector({ authorization: auth() });
    expect(connectorStatus(c)).toEqual({ tone: 'attention', label: 'Not in use' });
    expect(connectorSummaryLine(c)).toContain('not used by any project yet');
  });

  it('does NOT claim "Connected" while a project still needs resource selection', () => {
    const c = connector({
      provider: 'slack', label: 'Slack', resource_kind: 'multi',
      resource_noun: 'channel', requires_resource_selection: true,
      authorization: auth({
        provider: 'slack', account_label: 'Korvix AI',
        projects: [usage({ status: 'pending_selection' })],
      }),
    });
    expect(connectorStatus(c)).toEqual({ tone: 'attention', label: 'Needs setup' });
    expect(connectorSummaryLine(c)).toContain('needs setup');
  });

  it('is Connected once at least one project is fully bound', () => {
    const c = connector({ authorization: auth({ projects: [usage()] }) });
    expect(connectorStatus(c)).toEqual({ tone: 'connected', label: 'Connected' });
  });
});

describe('connectorSummaryLine', () => {
  it('names the connected account and the project count', () => {
    const c = connector({
      authorization: auth({ projects: [usage(), usage({ project_id: 'p2' })] }),
    });
    expect(connectorSummaryLine(c)).toBe('me@x.com · 2 projects');
  });

  it('singularises one project', () => {
    const c = connector({ authorization: auth({ projects: [usage()] }) });
    expect(connectorSummaryLine(c)).toBe('me@x.com · 1 project');
  });

  it('counts Slack channels with the right noun', () => {
    const c = connector({
      provider: 'slack', label: 'Slack', resource_kind: 'multi',
      resource_noun: 'channel', requires_resource_selection: true,
      authorization: auth({
        provider: 'slack', account_label: 'Korvix AI',
        projects: [usage({ resource_count: 2 }), usage({ project_id: 'p2', resource_count: 1 })],
      }),
    });
    expect(connectorSummaryLine(c)).toBe('Korvix AI · 2 projects · 3 channels');
  });

  it('does not restate the project count as a resource count for a single-resource provider', () => {
    // GitHub binds exactly one repository per project, so "1 project · 1
    // repository" is noise — and for Vercel (resource noun "project") it would
    // read "2 projects · 2 projects".
    const c = connector({
      provider: 'github', label: 'GitHub', resource_kind: 'single',
      resource_noun: 'repository', requires_resource_selection: true,
      authorization: auth({
        provider: 'github', account_label: 'korvix-ai',
        projects: [usage({ resource_count: 1 })],
      }),
    });
    expect(connectorSummaryLine(c)).toBe('korvix-ai · 1 project');
  });

  it('never invents a resource count for a whole-account provider', () => {
    // Gmail binds the authorized mailbox — there is no "3 channels" to report,
    // and the shared model must not make that mistake easy.
    const c = connector({
      authorization: auth({ projects: [usage({ resource_count: 5 })] }),
    });
    expect(connectorSummaryLine(c)).toBe('me@x.com · 1 project');
    expect(connectorSummaryLine(c)).not.toMatch(/resource|channel|repositor/);
  });

  it('surfaces how many projects still need setup', () => {
    const c = connector({
      provider: 'vercel', label: 'Vercel', resource_kind: 'single',
      resource_noun: 'project', requires_resource_selection: true,
      authorization: auth({
        provider: 'vercel', account_label: 'Acme',
        projects: [usage({ resource_count: 1 }), usage({ project_id: 'p2', status: 'pending_selection' })],
      }),
    });
    expect(connectorSummaryLine(c)).toBe('Acme · 2 projects · 1 needs setup');
  });
});

describe('connectorUsage', () => {
  it('is all zeros without an authorization', () => {
    expect(connectorUsage(connector())).toEqual({ projects: 0, pending: 0, resources: 0 });
  });

  it('totals resources across projects', () => {
    const c = connector({
      authorization: auth({
        projects: [usage({ resource_count: 2 }), usage({ project_id: 'p2', resource_count: 3 })],
      }),
    });
    expect(connectorUsage(c)).toEqual({ projects: 2, pending: 0, resources: 5 });
  });
});
