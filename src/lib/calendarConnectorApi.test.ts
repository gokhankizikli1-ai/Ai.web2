import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as calendarApi from '@/lib/calendarConnectorApi';
import {
  startCalendarConnect, beginCalendarConnectRedirect, getCalendarConnection,
  syncCalendar, disconnectCalendar,
} from '@/lib/calendarConnectorApi';

/**
 * Google Calendar connector — frontend client.
 *
 * Verifies the client hits the real backend endpoints, attaches the session
 * bearer, drives the browser to the server-provided Google authorization URL,
 * and surfaces truthful error/partial states. Critically it also proves the
 * client has NO mutation call toward Google and never handles a token. Zero real
 * network: fetch is stubbed and inspected.
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
  vi.stubGlobal('window', { location: { assign, href: '' } });
  return assign;
}

const CONNECTION = {
  project_id: 'p1',
  provider: 'calendar',
  google_email: 'me@gmail.com',
  calendar_id: 'primary',
  time_zone: 'Europe/Istanbul',
  scopes: ['https://www.googleapis.com/auth/calendar.events.readonly'],
  status: 'connected',
  connected: true,
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
  last_sync_at: '2026-03-02T00:00:00Z',
};

const START_PAYLOAD = {
  authorization_url:
    'https://accounts.google.com/o/oauth2/v2/auth?client_id=cid&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.events.readonly&state=abc',
  state: 'abc',
  scopes: ['https://www.googleapis.com/auth/calendar.events.readonly'],
};

describe('calendarConnectorApi — connect flow', () => {
  it('startCalendarConnect POSTs connect/start with the session bearer', async () => {
    reply(200, START_PAYLOAD);
    const res = await startCalendarConnect('p1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.authorization_url).toContain('accounts.google.com');
      expect(res.data.scopes).toEqual([
        'https://www.googleapis.com/auth/calendar.events.readonly',
      ]);
    }
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toMatch(/\/v2\/calendar\/projects\/p1\/connect\/start$/);
    expect(calls[0].auth).toBe('Bearer JWT-tok');
    // The client never sends a user id — identity is the backend session.
    expect(calls[0].body).toBeUndefined();
  });

  it('encodes the project id into the path', async () => {
    reply(200, START_PAYLOAD);
    await startCalendarConnect('p 1/x');
    expect(calls[0].url).toContain('/projects/p%201%2Fx/connect/start');
  });

  it('beginCalendarConnectRedirect navigates to the Google consent URL', async () => {
    reply(200, START_PAYLOAD);
    const assign = stubLocation();
    const res = await beginCalendarConnectRedirect('p1');
    expect(res.ok).toBe(true);
    expect(assign).toHaveBeenCalledWith(START_PAYLOAD.authorization_url);
  });

  it('beginCalendarConnectRedirect does NOT navigate when start fails', async () => {
    reply(503, null, 'not configured');
    const assign = stubLocation();
    const res = await beginCalendarConnectRedirect('p1');
    expect(res.ok).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('calendarConnectorApi — status / sync / disconnect', () => {
  it('getCalendarConnection GETs the safe connection view', async () => {
    reply(200, { connection: CONNECTION, connected: true });
    const res = await getCalendarConnection('p1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.connected).toBe(true);
      expect(res.data.connection?.google_email).toBe('me@gmail.com');
      expect(res.data.connection?.time_zone).toBe('Europe/Istanbul');
    }
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toMatch(/\/v2\/calendar\/projects\/p1\/connection$/);
  });

  it('reports "not connected" without inventing a connection', async () => {
    reply(200, { connection: null, connected: false });
    const res = await getCalendarConnection('p1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.connected).toBe(false);
      expect(res.data.connection).toBeNull();
    }
  });

  it('syncCalendar POSTs the sync and returns the bounded report', async () => {
    reply(200, {
      sync: {
        project_id: 'p1', calendar_id: 'primary', google_email: 'me@gmail.com',
        recorded: 4, deduplicated: 9, rejected: 0, events: 13,
        window_start: '2026-03-03T12:00:00Z', window_end: '2026-04-09T12:00:00Z',
        errors: {}, ok: true,
      },
    });
    const res = await syncCalendar('p1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.sync.recorded).toBe(4);
      expect(res.data.sync.ok).toBe(true);
      expect(res.data.sync.window_start).toBe('2026-03-03T12:00:00Z');
    }
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toMatch(/\/v2\/calendar\/projects\/p1\/sync$/);
  });

  it('surfaces a PARTIAL sync truthfully (ok:false with errors)', async () => {
    reply(200, {
      sync: {
        project_id: 'p1', calendar_id: 'primary', google_email: '',
        recorded: 0, deduplicated: 0, rejected: 0, events: 0,
        window_start: '', window_end: '',
        errors: { events: 'CalendarRateLimitError (HTTP 429)' }, ok: false,
      },
    });
    const res = await syncCalendar('p1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.sync.ok).toBe(false);
      expect(Object.keys(res.data.sync.errors)).toEqual(['events']);
    }
  });

  it('disconnectCalendar DELETEs and reports whether Google was revoked', async () => {
    reply(200, { removed: true, connected: false, revoked_remotely: false });
    const res = await disconnectCalendar('p1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.removed).toBe(true);
      // Truthful: the shared Google grant was intentionally left alone.
      expect(res.data.revoked_remotely).toBe(false);
    }
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toMatch(/\/v2\/calendar\/projects\/p1\/connection$/);
  });
});

describe('calendarConnectorApi — truthful failures', () => {
  it('prefers the backend structured detail message', async () => {
    nextResponse = {
      status: 409,
      body: { success: false, data: null, error: null,
              detail: { code: 'NOT_CONNECTED', message: 'Project is not connected to Google Calendar.' } },
    };
    const res = await syncCalendar('p1');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(409);
      expect(res.message).toBe('Project is not connected to Google Calendar.');
    }
  });

  it('surfaces 503 when the connector is disabled on the server', async () => {
    reply(503, null, 'disabled');
    const res = await getCalendarConnection('p1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(503);
  });

  it('surfaces 404 for a project the user does not own', async () => {
    reply(404, null, 'Project not found.');
    const res = await getCalendarConnection('p1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(404);
  });

  it('reports an unreachable server rather than a fake success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const res = await getCalendarConnection('p1');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(0);
      expect(res.message).toBe('Could not reach the server.');
    }
  });

  it('omits the Authorization header when there is no session token', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
    });
    reply(200, { connection: null, connected: false });
    await getCalendarConnection('p1');
    expect(calls[0].auth).toBeUndefined();
  });
});

describe('calendarConnectorApi — read-only surface', () => {
  it('exposes no call that could create, edit, move or delete an event', () => {
    const exported = Object.keys(calendarApi);
    const forbidden = /create|update|edit|delete[^C]|remove|move|insert|patch|quickAdd/i;
    const offenders = exported.filter((n) => forbidden.test(n));
    expect(offenders).toEqual([]);
    // Only the four backend operations plus the redirect helper are exposed.
    expect(new Set(exported)).toEqual(new Set([
      'startCalendarConnect', 'getCalendarConnection', 'syncCalendar',
      'disconnectCalendar', 'beginCalendarConnectRedirect',
    ]));
  });
});
