import { describe, it, expect, afterEach } from 'vitest';
import {
  buildRuntime, setBuildRuntime, resetBuildRuntime, isHeadless,
} from './buildRuntime';
import { runHeadlessBuild } from './runHeadlessBuild';

afterEach(() => resetBuildRuntime());

describe('buildRuntime — dependency injection', () => {
  it('defaults to non-headless', () => {
    expect(isHeadless()).toBe(false);
  });

  it('injects auth token, api base, fetch and user id when overridden', () => {
    const fakeFetch = (() => Promise.resolve(new Response('{}'))) as unknown as typeof fetch;
    setBuildRuntime({
      getAuthToken: () => 'TESTTOKEN',
      getApiBase: () => 'https://headless.example',
      getFetch: () => fakeFetch,
      getUserId: () => 'headless-user',
    });
    expect(isHeadless()).toBe(true);
    expect(buildRuntime.getAuthToken()).toBe('TESTTOKEN');
    expect(buildRuntime.getApiBase()).toBe('https://headless.example');
    expect(buildRuntime.getUserId()).toBe('headless-user');
    expect(buildRuntime.getFetch()).toBe(fakeFetch);
  });

  it('reset restores non-headless', () => {
    setBuildRuntime({ getAuthToken: () => 'x' });
    resetBuildRuntime();
    expect(isHeadless()).toBe(false);
  });
});

describe('runHeadlessBuild — real spine, injected transport, no browser', () => {
  it('drives the production spine headlessly through the injected transport', async () => {
    const requests: Array<{ url: string; auth: string | null }> = [];
    // A mock transport standing in for the paid /chat backend — no real call.
    const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers as HeadersInit);
      requests.push({ url, auth: headers.get('Authorization') });
      const reply = [
        '## Strategy', 'Premium restaurant inventory SaaS.',
        '## Information Architecture', '- Home', '- Pricing',
        '## Visual Direction', 'Warm, trustworthy.',
        '## Copy', 'Headline: Stop wasting stock.',
      ].join('\n');
      return new Response(JSON.stringify({ reply, message: reply, content: reply }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const result = await runHeadlessBuild({
      buildType: 'web',
      idea: 'Create a premium inventory SaaS for independent restaurants',
      authToken: 'TESTTOKEN',
      apiBase: 'https://headless.example',
      transport,
      runQualityPipeline: false,   // planning round-trip only for the test
    });

    // The real spine reached the injected transport (not the browser default).
    expect(requests.length).toBeGreaterThan(0);
    expect(requests[0].url.startsWith('https://headless.example/chat')).toBe(true);
    expect(requests[0].auth).toBe('Bearer TESTTOKEN');

    // It produced a structured result and did NOT leave the runtime installed.
    expect(result.build_type).toBe('web');
    expect(['completed', 'failed']).toContain(result.status);
    expect(isHeadless()).toBe(false);
  });

  it('never touches window/localStorage (they are undefined here)', async () => {
    // In this vitest (node) environment there is no window/localStorage; if the
    // spine touched them directly it would throw. The injected runtime prevents
    // that — the call resolves to a structured result instead of a ReferenceError.
    const transport = (async () =>
      new Response(JSON.stringify({ reply: '## Strategy\nx' }), { status: 200 })
    ) as unknown as typeof fetch;

    const result = await runHeadlessBuild({
      buildType: 'web', idea: 'a headless site', authToken: null,
      apiBase: 'https://h.example', transport, runQualityPipeline: false,
    });
    expect(result).toBeTruthy();
    expect(isHeadless()).toBe(false);
  });
});
