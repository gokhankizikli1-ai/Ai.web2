import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  startSlackConnect, beginSlackConnectRedirect, getSlackConnection,
  getSlackPendingChannels, selectSlackChannels, syncSlack, disconnectSlack,
} from '@/lib/slackConnectorApi';

/**
 * Slack connector — frontend client.
 *
 * Verifies the client hits the real backend endpoints, attaches the session
 * bearer, drives the browser to the server-provided authorization URL, sends
 * only server-provided channel ids on selection, and surfaces truthful
 * error/partial states. Critically it also proves the client has NO mutation
 * call and never handles a token. Zero real network: fetch is stubbed and
 * inspected.
 */

interface Captured { url: string; method: string; body: unknown; auth?: string }

let calls: Captured[];
let nextResponse: { status: number; body: unknown };

function stubFetch() {
  calls = [];
  nextResponse = { status: 200, body: { success: true, data: {}, error: null } };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers || {}) as Record<string, string>;
    calls.push({
      url,
      method: init?.method || 'GET',
      body: init?.body ? JSON.parse(init.body as string) : undefined,
      auth: headers['Authorization'],
    });
    return {
      ok: nextResponse.status >= 200 && nextResponse.status < 300,
      status: nextResponse.status,
      json: async () => nextResponse.body,
    } as unknown as Response;
  }));
}

beforeEach(() => {
  const storage: Record<string, string> = { korvix_access_token: 'JWT-tok' };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => { storage[k] = v; },
    removeItem: (k: string) => { delete storage[k]; },
    clear: () => { for (const k of Object.keys(storage)) delete storage[k]; },
  });
  stubFetch();
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function reply(status: number, data: unknown, error: string | null = null) {
  nextResponse = { status, body: { success: status < 400, data, error } };
}

/** Provide a `window` with a mockable location.assign (tests run in node). */
function stubLocation() {
  const assign = vi.fn();
  vi.stubGlobal('window', { location: { assign } });
  return assign;
}

const CONNECTION = {
  project_id: 'p1',
  provider: 'slack',
  team_id: 'T_WORKSPACE',
  team_name: 'Korvix HQ',
  bot_user_id: 'U0BOT',
  scopes: ['channels:read', 'channels:history', 'groups:read', 'groups:history'],
  channels: [{ channel_id: 'C_GENERAL', name: 'general', is_private: false }],
  channel_count: 1,
  status: 'connected',
  connected: true,
  needs_channel_selection: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  last_sync_at: '2024-01-02T00:00:00Z',
};

describe('slackConnectorApi', () => {
  describe('connect/start', () => {
    it('POSTs the project-scoped start endpoint with the session bearer', async () => {
      reply(200, { authorization_url: 'https://slack.com/oauth/v2/authorize?x=1', state: 's' });
      const res = await startSlackConnect('p1');
      expect(res.ok).toBe(true);
      expect(calls[0].method).toBe('POST');
      expect(calls[0].url).toContain('/v2/slack/projects/p1/connect/start');
      expect(calls[0].auth).toBe('Bearer JWT-tok');
      // The client never sends a user id — identity is the backend session.
      expect(calls[0].body).toBeUndefined();
    });

    it('encodes the project id', async () => {
      reply(200, { authorization_url: 'https://slack.com/x', state: 's' });
      await startSlackConnect('p 1/../evil');
      expect(calls[0].url).toContain('/projects/p%201%2F..%2Fevil/');
    });

    it('navigates to the server-provided authorization URL only', async () => {
      const assign = stubLocation();
      reply(200, { authorization_url: 'https://slack.com/oauth/v2/authorize?state=abc', state: 'abc' });
      await beginSlackConnectRedirect('p1');
      expect(assign).toHaveBeenCalledWith('https://slack.com/oauth/v2/authorize?state=abc');
    });

    it('does not navigate when the start call fails', async () => {
      const assign = stubLocation();
      reply(503, null, 'disabled');
      const res = await beginSlackConnectRedirect('p1');
      expect(assign).not.toHaveBeenCalled();
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.status).toBe(503);
    });
  });

  describe('connection status', () => {
    it('GETs the safe connection projection', async () => {
      reply(200, { connection: CONNECTION, connected: true });
      const res = await getSlackConnection('p1');
      expect(calls[0].method).toBe('GET');
      expect(calls[0].url).toContain('/v2/slack/projects/p1/connection');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.connection?.team_name).toBe('Korvix HQ');
        expect(res.data.connection?.channels[0].name).toBe('general');
      }
    });

    it('reports a not-connected project without inventing a connection', async () => {
      reply(200, { connection: null, connected: false });
      const res = await getSlackConnection('p1');
      expect(res.ok && res.data.connection).toBeNull();
    });

    it('carries an owner_mismatch status with every workspace field redacted', async () => {
      // The backend answers (so the UI can offer Reconnect/Remove) but withholds
      // the previous owner's Slack identity and channels.
      reply(200, {
        connection: {
          ...CONNECTION, team_id: null, team_name: null, bot_user_id: null,
          scopes: [], channels: [], channel_count: 0,
          status: 'owner_mismatch', connected: false,
          needs_channel_selection: false, last_sync_at: null,
        },
        connected: false,
      });
      const res = await getSlackConnection('p1');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.connection?.status).toBe('owner_mismatch');
        expect(res.data.connected).toBe(false);
        expect(res.data.connection?.team_name).toBeNull();
        expect(res.data.connection?.channels).toEqual([]);
      }
      expect(JSON.stringify(res)).not.toContain('Korvix HQ');
      expect(JSON.stringify(res)).not.toContain('T_WORKSPACE');
    });

    it('surfaces the backend detail message on an error', async () => {
      nextResponse = {
        status: 409,
        body: { success: false, data: null, error: null,
                detail: { code: 'CONNECTION_REVOKED', message: 'Reconnect Slack.' } },
      };
      const res = await getSlackConnection('p1');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.message).toBe('Reconnect Slack.');
    });

    it('reports an unreachable server rather than throwing', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
      const res = await getSlackConnection('p1');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.status).toBe(0);
    });
  });

  describe('pending channels', () => {
    it('GETs the picker source and carries Slack membership truth', async () => {
      reply(200, {
        channels: [
          { channel_id: 'C1', name: 'general', is_private: false, is_member: true },
          { channel_id: 'C2', name: 'random', is_private: false, is_member: false },
        ],
        count: 2, max_selected: 10,
      });
      const res = await getSlackPendingChannels('p1');
      expect(calls[0].url).toContain('/v2/slack/projects/p1/pending-channels');
      expect(calls[0].url).not.toContain('refresh');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.max_selected).toBe(10);
        expect(res.data.channels[1].is_member).toBe(false);
      }
    });

    it('asks for a live re-read when refresh is requested', async () => {
      reply(200, { channels: [], count: 0, max_selected: 10 });
      await getSlackPendingChannels('p1', true);
      expect(calls[0].url).toContain('/pending-channels?refresh=true');
    });
  });

  describe('connect/select', () => {
    it('sends only the server-provided channel ids', async () => {
      reply(200, { connection: CONNECTION });
      const res = await selectSlackChannels('p1', ['C_GENERAL', 'C_PRODUCT']);
      expect(calls[0].method).toBe('POST');
      expect(calls[0].url).toContain('/v2/slack/projects/p1/connect/select');
      expect(calls[0].body).toEqual({ channel_ids: ['C_GENERAL', 'C_PRODUCT'] });
      // No workspace/team id is ever sent — the backend owns that binding.
      expect(JSON.stringify(calls[0].body)).not.toContain('team');
      expect(res.ok).toBe(true);
    });

    it('surfaces the backend refusal for a channel Korvix cannot read', async () => {
      nextResponse = {
        status: 400,
        body: { success: false, data: null, error: null,
                detail: { code: 'CHANNEL_NOT_JOINED',
                          message: 'Invite Korvix to that channel in Slack first, then refresh the list.' } },
      };
      const res = await selectSlackChannels('p1', ['C_LURKER']);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.status).toBe(400);
        expect(res.message).toContain('Invite Korvix');
      }
    });
  });

  describe('sync', () => {
    it('POSTs the bounded sync and returns a truthful report', async () => {
      reply(200, {
        sync: {
          project_id: 'p1', team_id: 'T_WORKSPACE', channels: 2, channels_read: 2,
          messages: 12, threads: 1, recorded: 9, deduplicated: 3, rejected: 0,
          window_start: '2024-01-01T00:00:00Z', truncated: false, errors: {}, ok: true,
        },
      });
      const res = await syncSlack('p1');
      expect(calls[0].method).toBe('POST');
      expect(calls[0].url).toContain('/v2/slack/projects/p1/sync');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.sync.recorded).toBe(9);
        expect(res.data.sync.ok).toBe(true);
      }
    });

    it('preserves a partial failure instead of reading it as success', async () => {
      reply(200, {
        sync: {
          project_id: 'p1', team_id: 'T', channels: 2, channels_read: 1, messages: 4,
          threads: 0, recorded: 4, deduplicated: 0, rejected: 0,
          window_start: '2024-01-01T00:00:00Z', truncated: false,
          errors: { 'channel:C2': 'SlackAccessError (not_in_channel)' }, ok: false,
        },
      });
      const res = await syncSlack('p1');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.sync.ok).toBe(false);
        expect(Object.keys(res.data.sync.errors)).toHaveLength(1);
      }
    });
  });

  describe('disconnect', () => {
    it('DELETEs the connection and reports shared-workspace truth', async () => {
      reply(200, { removed: true, connected: false, workspace_still_connected: true });
      const res = await disconnectSlack('p1');
      expect(calls[0].method).toBe('DELETE');
      expect(calls[0].url).toContain('/v2/slack/projects/p1/connection');
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.data.workspace_still_connected).toBe(true);
    });
  });

  describe('security surface', () => {
    it('never sends or receives a token in any call', async () => {
      reply(200, { connection: CONNECTION, connected: true });
      await getSlackConnection('p1');
      await selectSlackChannels('p1', ['C1']);
      await syncSlack('p1');
      await disconnectSlack('p1');
      const sent = JSON.stringify(calls.map((c) => c.body));
      expect(sent).not.toContain('xoxb');
      expect(sent).not.toContain('token');
      // The only credential in play is the Korvix session bearer.
      expect(new Set(calls.map((c) => c.auth))).toEqual(new Set(['Bearer JWT-tok']));
    });

    it('exposes no Slack write operation', async () => {
      const api = await import('@/lib/slackConnectorApi');
      const names = Object.keys(api);
      expect(names.sort()).toEqual([
        'beginSlackConnectRedirect', 'disconnectSlack', 'getSlackConnection',
        'getSlackPendingChannels', 'selectSlackChannels', 'startSlackConnect',
        'syncSlack',
      ]);
      for (const forbidden of ['post', 'send', 'invite', 'archive', 'react', 'upload']) {
        expect(names.some((n) => n.toLowerCase().includes(forbidden))).toBe(false);
      }
    });

    it('only ever calls /v2/slack/* paths', async () => {
      reply(200, { connection: CONNECTION, connected: true });
      await getSlackConnection('p1');
      await getSlackPendingChannels('p1');
      await syncSlack('p1');
      for (const c of calls) {
        expect(c.url).toContain('/v2/slack/');
        expect(c.url).not.toContain('slack.com');
      }
    });
  });
});
