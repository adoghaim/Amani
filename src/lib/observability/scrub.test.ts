import { describe, expect, it } from 'vitest';
import {
  scrubBreadcrumb,
  scrubDomTarget,
  scrubEvent,
  scrubText,
  scrubUrl,
  scrubValue,
  type ScrubbableEvent,
} from './scrub';

const REPORT_ID = '3f9a1c2e-7b4d-4e8a-9f01-2c5d6e7a8b90';

describe('scrubText', () => {
  it('redacts email addresses', () => {
    expect(scrubText('failed for jane.doe+lab@example.co.uk')).toBe(
      'failed for [email]',
    );
  });

  it('redacts UUIDs', () => {
    expect(scrubText(`row ${REPORT_ID} missing`)).toBe('row [id] missing');
  });

  it('redacts JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcDEF-_123';
    expect(scrubText(`Bearer ${jwt}`)).toBe('Bearer [token]');
  });

  it('leaves ordinary prose untouched', () => {
    const message = 'Failed to save biomarkers: duplicate key value';
    expect(scrubText(message)).toBe(message);
  });

  /*
    Module-level /g regexes keep `lastIndex` between calls when driven with
    .test()/.exec(). Two identical inputs must scrub identically.
  */
  it('is stateless across repeated calls', () => {
    const input = `a@b.com and ${REPORT_ID}`;
    expect(scrubText(input)).toBe(scrubText(input));
    expect(scrubText(input)).toBe('[email] and [id]');
  });

  it('redacts every occurrence, not just the first', () => {
    expect(scrubText(`${REPORT_ID} ${REPORT_ID}`)).toBe('[id] [id]');
  });
});

describe('scrubUrl', () => {
  it('parameterises a report UUID in the path', () => {
    expect(scrubUrl(`https://amanibiometrics.com/app/reports/${REPORT_ID}`)).toBe(
      'https://amanibiometrics.com/app/reports/:id',
    );
  });

  it('keeps the route shape so the crash is still locatable', () => {
    expect(scrubUrl(`/app/reports/${REPORT_ID}/trends`)).toBe(
      '/app/reports/:id/trends',
    );
  });

  it('drops the query string, including the PKCE code', () => {
    expect(scrubUrl('https://amanibiometrics.com/login?code=abc123&next=/app')).toBe(
      'https://amanibiometrics.com/login',
    );
  });

  it('drops the fragment carrying a Supabase access token', () => {
    const url =
      'https://amanibiometrics.com/#access_token=eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig&type=recovery';
    expect(scrubUrl(url)).toBe('https://amanibiometrics.com/');
  });

  it('parameterises timestamped storage keys', () => {
    expect(
      scrubUrl(`https://x.supabase.co/storage/v1/object/lab-files/${REPORT_ID}/1725379200000.pdf`),
    ).toBe('https://x.supabase.co/storage/v1/object/lab-files/:id/:id');
  });

  it('strips a biomarker filter from a Supabase REST query', () => {
    expect(
      scrubUrl('https://x.supabase.co/rest/v1/report_items?select=*&value=gt.140'),
    ).toBe('https://x.supabase.co/rest/v1/report_items');
  });

  it('leaves plain routes and short numeric segments alone', () => {
    expect(scrubUrl('/app/reports')).toBe('/app/reports');
    expect(scrubUrl('/app/tracker/2026')).toBe('/app/tracker/2026');
    expect(scrubUrl('https://amanibiometrics.com/')).toBe(
      'https://amanibiometrics.com/',
    );
  });

  it('does not mangle hashed asset filenames', () => {
    expect(scrubUrl('https://amanibiometrics.com/assets/index-DkH2xY9a.js')).toBe(
      'https://amanibiometrics.com/assets/index-DkH2xY9a.js',
    );
  });
});

describe('scrubDomTarget', () => {
  /*
    The leak this exists for. htmlTreeAsString unconditionally appends
    aria-label/title/alt values, and CycleDial's label is literally cycle data.
    No Sentry init option disables that loop.
  */
  it('redacts the cycle position out of an aria-label', () => {
    const target =
      'div.dashboard > svg[aria-label="Cycle day 21 of 28, luteal phase"]';
    const scrubbed = scrubDomTarget(target);

    expect(scrubbed).not.toContain('Cycle day 21');
    expect(scrubbed).not.toContain('luteal');
    expect(scrubbed).toBe('div.dashboard > svg[aria-label]');
  });

  it('redacts biomarker values hiding in title and alt attributes', () => {
    const target =
      'li.biomarker-row[title="Ferritin 12 ng/mL (low)"] > img[alt="Ferritin trend"]';
    const scrubbed = scrubDomTarget(target);

    expect(scrubbed).not.toContain('Ferritin');
    expect(scrubbed).not.toContain('12 ng/mL');
    expect(scrubbed).toBe('li.biomarker-row[title] > img[alt]');
  });

  it('redacts onboarding context echoed into an aria-label', () => {
    expect(scrubDomTarget('button[aria-label="Remove endometriosis"]')).toBe(
      'button[aria-label]',
    );
  });

  it('keeps the element path, ids, classes, type and name', () => {
    const target = 'form#report-form > button.btn.btn-primary[type="submit"][name="save"]';
    expect(scrubDomTarget(target)).toBe(target);
  });
});

describe('scrubValue', () => {
  it('redacts identifiers nested in structured data', () => {
    expect(
      scrubValue({ a: [{ b: `user ${REPORT_ID}` }], c: 42, d: null }),
    ).toEqual({ a: [{ b: 'user [id]' }], c: 42, d: null });
  });

  it('terminates on deeply nested input', () => {
    let deep: Record<string, unknown> = { email: 'a@b.com' };
    for (let i = 0; i < 20; i += 1) deep = { nested: deep };
    expect(() => scrubValue(deep)).not.toThrow();
  });
});

describe('scrubBreadcrumb', () => {
  it('drops console breadcrumbs outright', () => {
    expect(
      scrubBreadcrumb({
        category: 'console',
        message: '[pdfExtractor] Page 1 preview: TSH 4.2 uIU/mL Ferritin 12',
      }),
    ).toBeNull();
  });

  it('scrubs the DOM target of a ui.click breadcrumb', () => {
    const crumb = {
      category: 'ui.click',
      message: 'svg[aria-label="Cycle day 21 of 28, luteal phase"]',
    };
    scrubBreadcrumb(crumb);
    expect(crumb.message).toBe('svg[aria-label]');
  });

  it('parameterises fetch breadcrumb URLs and keeps the useful metadata', () => {
    const crumb = {
      category: 'fetch',
      data: {
        method: 'GET',
        url: `https://x.supabase.co/rest/v1/report_items?report_id=eq.${REPORT_ID}`,
        status_code: 500,
      },
    };
    scrubBreadcrumb(crumb);

    expect(crumb.data.url).toBe('https://x.supabase.co/rest/v1/report_items');
    expect(crumb.data.method).toBe('GET');
    expect(crumb.data.status_code).toBe(500);
  });

  it('parameterises navigation from/to', () => {
    const crumb = {
      category: 'navigation',
      data: { from: '/app/reports', to: `/app/reports/${REPORT_ID}` },
    };
    scrubBreadcrumb(crumb);

    expect(crumb.data.from).toBe('/app/reports');
    expect(crumb.data.to).toBe('/app/reports/:id');
  });
});

describe('scrubEvent', () => {
  /** A representative crash event, shaped the way the browser SDK builds one. */
  function sampleEvent(): ScrubbableEvent {
    return {
      message: `Failed to load report ${REPORT_ID}`,
      request: {
        url: `https://amanibiometrics.com/app/reports/${REPORT_ID}?tab=trends`,
        headers: {
          Referer: `https://amanibiometrics.com/app/reports/${REPORT_ID}`,
          'User-Agent': 'Mozilla/5.0',
          Cookie: 'sb-access-token=eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig',
        },
        data: { biomarker: 'Ferritin', value: 12, unit: 'ng/mL' },
        cookies: { 'sb-access-token': 'secret' },
        query_string: 'tab=trends',
      },
      user: { id: REPORT_ID, email: 'jane@example.com', ip_address: '10.0.0.1' },
      extra: { interpretation: 'Your ferritin is low, which can explain fatigue.' },
      exception: {
        values: [
          {
            value: `Row not found for user jane@example.com (${REPORT_ID})`,
          },
        ],
      },
      breadcrumbs: [
        { category: 'console', message: '[pdfExtractor] TSH 4.2 uIU/mL' },
        {
          category: 'ui.click',
          message: 'svg[aria-label="Cycle day 21 of 28, luteal phase"]',
        },
        {
          category: 'navigation',
          data: { from: '/app', to: `/app/reports/${REPORT_ID}` },
        },
      ],
    };
  }

  it('removes every direct identifier from the event', () => {
    const serialised = JSON.stringify(scrubEvent(sampleEvent()));

    expect(serialised).not.toContain(REPORT_ID);
    expect(serialised).not.toContain('jane@example.com');
    expect(serialised).not.toContain('10.0.0.1');
  });

  it('removes health content from the event', () => {
    const serialised = JSON.stringify(scrubEvent(sampleEvent()));

    expect(serialised).not.toContain('Ferritin');
    expect(serialised).not.toContain('ng/mL');
    expect(serialised).not.toContain('TSH');
    expect(serialised).not.toContain('luteal');
    expect(serialised).not.toContain('fatigue');
  });

  it('drops user, extra, request body, cookies and query string', () => {
    const event = scrubEvent(sampleEvent());

    expect(event.user).toBeUndefined();
    expect(event.extra).toBeUndefined();
    expect(event.request?.data).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.query_string).toBeUndefined();
    expect(event.request?.headers?.Cookie).toBeUndefined();
  });

  it('parameterises both request.url and the Referer header', () => {
    const event = scrubEvent(sampleEvent());

    expect(event.request?.url).toBe('https://amanibiometrics.com/app/reports/:id');
    expect(event.request?.headers?.Referer).toBe(
      'https://amanibiometrics.com/app/reports/:id',
    );
    /* User-Agent is not an identifier and stays, it is needed to reproduce. */
    expect(event.request?.headers?.['User-Agent']).toBe('Mozilla/5.0');
  });

  it('keeps the event debuggable', () => {
    const event = scrubEvent(sampleEvent());

    expect(event.message).toBe('Failed to load report [id]');
    expect(event.exception?.values?.[0]?.value).toBe(
      'Row not found for user [email] ([id])',
    );
    /* The console crumb is dropped; the other two survive, scrubbed. */
    expect(event.breadcrumbs?.map((c) => c.category)).toEqual([
      'ui.click',
      'navigation',
    ]);
  });

  /*
    Over-scrubbing is a failure too: a report with no usable stack is as
    useless as no report. Frames are deliberately never rewritten.
  */
  it('leaves a normal stack trace intact', () => {
    const event = {
      exception: {
        values: [
          {
            type: 'TypeError',
            value: "Cannot read properties of undefined (reading 'value')",
            stacktrace: {
              frames: [
                {
                  filename: 'https://amanibiometrics.com/assets/index-DkH2xY9a.js',
                  function: 'scoreBiomarker',
                  lineno: 412,
                  colno: 17,
                  in_app: true,
                },
                {
                  filename: 'https://amanibiometrics.com/assets/react-vendor-9f2a.js',
                  function: 'renderWithHooks',
                  lineno: 88,
                  colno: 3,
                  in_app: false,
                },
              ],
            },
          },
        ],
      },
    };
    const before = structuredClone(event);

    scrubEvent(event);

    expect(event.exception.values[0]).toEqual(before.exception.values[0]);
  });

  it('handles a minimal event without throwing', () => {
    expect(() => scrubEvent({})).not.toThrow();
    expect(scrubEvent({})).toEqual({});
  });
});
