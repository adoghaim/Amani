import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
  Netlify serves public/_headers and public/_redirects (copied into dist/).
  Review F028 / F113: no security header was sent. Review F068 / F109: source
  maps were public. Nothing in dev or e2e applies these files, so this pins
  them against Netlify's documented rules: _headers blocks are a path line
  followed by indented "Name: value" lines; _redirects rules apply first match
  first, a splat (*) may only end the path, and a rule without "!" never
  shadows a file that exists.
*/

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const meaningful = (text: string) => text.split('\n').filter(line => line.trim() && !line.trim().startsWith('#'));

function parseHeaders(text: string): Map<string, [name: string, value: string][]> {
  const blocks = new Map<string, [string, string][]>();
  let current: [string, string][] | undefined;
  for (const line of meaningful(text)) {
    if (!/^\s/.test(line)) {
      current = [];
      blocks.set(line.trim(), current);
      continue;
    }
    const colon = line.indexOf(':');
    expect(current, `header line outside a path block: ${line}`).toBeDefined();
    current!.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return blocks;
}

function parsePolicy(policy: string): Map<string, string[]> {
  return new Map(policy.split(';').map(d => d.trim()).filter(Boolean).map(d => {
    const [name, ...sources] = d.split(/\s+/);
    return [name!, sources];
  }));
}

const headerBlocks = parseHeaders(read('public/_headers'));
const everyResponse = headerBlocks.get('/*') ?? [];
const header = (name: string) => {
  const values = everyResponse.filter(([n]) => n.toLowerCase() === name.toLowerCase()).map(([, v]) => v);
  // Netlify joins repeated names with commas, which would merge two CSPs into one header.
  expect(values, name).toHaveLength(1);
  return values[0]!;
};

/** Whether one CSP host-source (exact origin or "https://*.host") allows this origin. */
function sourceAllows(source: string, origin: string): boolean {
  if (source === origin) return true;
  const wildcard = /^(https?:\/\/)\*\.(.+)$/.exec(source);
  if (!wildcard) return false;
  const [scheme, host] = [wildcard[1]!, wildcard[2]!];
  return origin.startsWith(scheme) && origin.slice(scheme.length).endsWith(`.${host}`);
}

/**
 * Every https origin written in a non-test file under src/ that creates a
 * script element, plus any external <script src> in index.html.
 */
function scriptLoaderOrigins(): string[] {
  const origins = new Set<string>();
  const collect = (text: string) => {
    for (const match of text.matchAll(/https?:\/\/[^/\s'"`$<>)]+/g)) origins.add(match[0]);
  };
  for (const entry of readdirSync(join(process.cwd(), 'src'), { recursive: true }) as string[]) {
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
    const text = read(join('src', entry));
    if (/createElement\(\s*['"`]script['"`]/.test(text)) collect(text);
  }
  for (const tag of read('index.html').matchAll(/<script\b[^>]*\bsrc="(https?:\/\/[^"]+)"/g)) collect(tag[1]!);
  return [...origins];
}

const projectRef = /^project_id = "([a-z0-9]+)"$/m.exec(read('supabase/config.toml'))?.[1];

const GTM = 'https://www.googletagmanager.com';
const GA = 'https://*.google-analytics.com';

const REPORT_ONLY_POLICY = {
  'default-src': ["'self'"],
  'script-src': ["'self'", GTM],
  'style-src': ["'self'"],
  'img-src': ["'self'", GTM, GA],
  'font-src': ["'self'"],
  'connect-src': ["'self'", `https://${projectRef}.supabase.co`, `wss://${projectRef}.supabase.co`, GTM, GA, 'https://*.google.com'],
  'worker-src': ["'self'"],
  'frame-src': ["'none'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
  'base-uri': ["'self'"],
  'object-src': ["'none'"],
};

describe('security headers on every response (F028, F113)', () => {
  it('sends nosniff, a strict-origin referrer policy and refuses framing', () => {
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(header('X-Frame-Options')).toBe('DENY');
  });

  it('enforces a policy that names only the fixed GA4 hosts, so it holds in every Netlify deploy context', () => {
    const enforced = parsePolicy(header('Content-Security-Policy'));
    expect(Object.fromEntries(enforced)).toEqual({
      'script-src': ["'self'", GTM],
      'style-src': ["'self'"],
      'img-src': ["'self'", GTM, GA],
      'font-src': ["'self'"],
      'worker-src': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      'base-uri': ["'self'"],
      'object-src': ["'none'"],
    });
    for (const sources of enforced.values()) {
      for (const source of sources) expect(["'self'", "'none'", GTM, GA], source).toContain(source);
    }
    // connect-src (or default-src, its fallback) depends on each context's VITE_SUPABASE_URL;
    // frame-src and child-src hide the deploy-preview Drawer. All stay report-only.
    for (const directive of ['default-src', 'connect-src', 'frame-src', 'child-src']) {
      expect(enforced.has(directive), directive).toBe(false);
    }
  });

  it('reports against the full policy: self-hosted code, GA4, and this Supabase project as the only other origins', () => {
    expect(projectRef).toBeTruthy();
    const policy = parsePolicy(header('Content-Security-Policy-Report-Only'));
    expect(Object.fromEntries(policy)).toEqual(REPORT_ONLY_POLICY);
    // The full policy only adds to what is enforced, so enforcing it later loosens nothing.
    for (const [directive, sources] of parsePolicy(header('Content-Security-Policy'))) {
      expect(policy.get(directive), directive).toEqual(sources);
    }
  });

  it('allows every external origin the source loads a script from, in both policies', () => {
    // Read from the source, not restated: a feature that adds a runtime script
    // loader fails here instead of being blocked silently in production.
    const origins = scriptLoaderOrigins();
    expect(origins, 'the scan must find the gtag.js loader in src/lib/analytics/ga4.ts').toContain('https://www.googletagmanager.com');
    for (const name of ['Content-Security-Policy', 'Content-Security-Policy-Report-Only']) {
      const policy = parsePolicy(header(name));
      const scriptSources = policy.get('script-src-elem') ?? policy.get('script-src') ?? policy.get('default-src') ?? [];
      for (const origin of origins) {
        expect(scriptSources.some(source => sourceAllows(source, origin)), `${name} script policy blocks ${origin}`).toBe(true);
      }
    }
  });

  it('allows the GA4 hosts (without Ads features) for beacons, and nothing broader', () => {
    // https://developers.google.com/tag-platform/security/guides/csp, "Google Analytics".
    const [gtm, ga] = [GTM, GA];
    const enforced = parsePolicy(header('Content-Security-Policy'));
    expect(enforced.get('script-src')).toEqual(["'self'", gtm]);
    expect(enforced.get('img-src')).toEqual(["'self'", gtm, ga]);
    const reportOnly = parsePolicy(header('Content-Security-Policy-Report-Only'));
    expect(reportOnly.get('connect-src')).toEqual(expect.arrayContaining([gtm, ga, 'https://*.google.com']));
    for (const policy of [enforced, reportOnly]) {
      for (const [directive, sources] of policy) {
        for (const source of sources) {
          expect(["'unsafe-inline'", "'unsafe-eval'", '*', 'https:', 'http:', 'data:'], `${directive} ${source}`).not.toContain(source);
        }
      }
      for (const source of policy.get('script-src') ?? []) expect(source, 'no wildcard script host').not.toContain('*');
    }
  });

  it('denies device and payment APIs the web app never calls, and leaves clipboard-write alone', () => {
    const features = new Map(header('Permissions-Policy').split(',').map(f => {
      const [name, allowlist] = f.trim().split('=');
      return [name!, allowlist];
    }));
    for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'usb']) {
      expect(features.get(feature), feature).toBe('()');
    }
    // DoctorQuestionsCard copies questions with navigator.clipboard.writeText.
    expect(features.has('clipboard-write')).toBe(false);
  });

  it('keeps the apple-app-site-association Content-Type', () => {
    expect(headerBlocks.get('/.well-known/apple-app-site-association')).toEqual([['Content-Type', 'application/json']]);
  });
});

interface RedirectRule { from: string; to: string; status: number; force: boolean }

const rules: RedirectRule[] = meaningful(read('public/_redirects')).map(line => {
  const [from, to, status = '301'] = line.trim().split(/\s+/);
  return { from: from!, to: to!, status: Number.parseInt(status, 10), force: status.endsWith('!') };
});

/** What Netlify serves for a path: the first rule that matches and is not shadowed by a real file. */
function serve(path: string, fileExists: boolean): { status: number; body: string } {
  for (const rule of rules) {
    const matches = rule.from.endsWith('/*') ? path.startsWith(rule.from.slice(0, -1)) : path === rule.from;
    if (matches && (rule.force || !fileExists)) return { status: rule.status, body: rule.to };
  }
  return fileExists ? { status: 200, body: path } : { status: 404, body: 'netlify-404' };
}

describe('source maps are not served (F068, F109)', () => {
  it('a request for a source map gets a 404, not the app shell', () => {
    // vite.config.ts builds none, so on a new deploy the file does not exist.
    expect(serve('/assets/index-02oK0VHv.js.map', false).status).toBe(404);
    expect(serve('/assets/react-vendor-CM0i3zGP.js.map', false).status).toBe(404);
  });

  it('every built asset still serves as itself', () => {
    expect(serve('/assets/index-02oK0VHv.js', true)).toEqual({ status: 200, body: '/assets/index-02oK0VHv.js' });
    expect(rules.filter(r => r.force)).toEqual([]);
  });

  it('client routes still fall back to the app shell, and the fallback stays last', () => {
    expect(serve('/app/reports', false)).toEqual({ status: 200, body: '/index.html' });
    expect(serve('/reset-password', false)).toEqual({ status: 200, body: '/index.html' });
    expect(rules[rules.length - 1]).toEqual({ from: '/*', to: '/index.html', status: 200, force: false });
  });

  it('uses no splat Netlify cannot match (only a trailing /*)', () => {
    for (const rule of rules) expect([-1, rule.from.length - 1], rule.from).toContain(rule.from.indexOf('*'));
  });
});
