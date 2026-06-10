/**
 * Minimal ambient declaration for `jsdom` — used ONLY by the sanitize test to
 * provide a DOM for DOMPurify in node. `@types/jsdom` is intentionally not a
 * dependency; the test needs nothing beyond `new JSDOM(html).window`.
 */
declare module 'jsdom' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export class JSDOM {
    constructor(html?: string, options?: unknown);
    readonly window: any;
  }
}
