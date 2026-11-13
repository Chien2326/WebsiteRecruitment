import type { createFormatter } from 'next-intl';

/**
 * Latin digits everywhere (1,200 not ၁,၂၀၀ / १,२०० / ১,২০০).
 *
 * Why: Node (server) and Chrome (browser) ship different ICU data - for `my` and `ne` the server printed native
 * digits while the browser printed Latin ones, so React threw hydration errors and one page could mix both.
 * Wages in Japan are always written 1,200円, so Latin digits are also what candidates see on the job sites.
 *
 * Usage: `const f = latn(useFormatter())` or `const f = latn(await getFormatter())` - then `f.number` /
 * `f.dateTime` work exactly as before. Only option objects are supported (this project uses no named formats).
 */
type Formatter = ReturnType<typeof createFormatter>;
type NumberOptions = Exclude<Parameters<Formatter['number']>[1], string | undefined>;
type DateOptions = Exclude<Parameters<Formatter['dateTime']>[1], string | undefined>;

export function latn(f: Formatter): Formatter {
  return {
    ...f,
    number: (value: number | bigint, options?: NumberOptions | string) =>
      f.number(value, { ...(typeof options === 'object' ? options : {}), numberingSystem: 'latn' }),
    dateTime: (value: Date | number, options?: DateOptions | string) =>
      f.dateTime(value, { ...(typeof options === 'object' ? options : {}), numberingSystem: 'latn' }),
  };
}
