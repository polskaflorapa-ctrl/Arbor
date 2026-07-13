import { localDateKey } from './localDateKey';

const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

test('uses the Warsaw calendar day when the UTC date is still the previous day', () => {
  process.env.TZ = 'Europe/Warsaw';
  const afterSummerMidnight = new Date('2026-07-10T22:15:00.000Z');

  expect(afterSummerMidnight.toISOString().slice(0, 10)).toBe('2026-07-10');
  expect(localDateKey(afterSummerMidnight)).toBe('2026-07-11');
});

test('keeps an exact local midnight on the same calendar day', () => {
  process.env.TZ = 'Europe/Warsaw';
  const localMidnight = new Date(2026, 0, 2, 0, 0, 0);

  expect(localDateKey(localMidnight)).toBe('2026-01-02');
});

test('rejects invalid dates instead of returning a malformed key', () => {
  expect(() => localDateKey(new Date('invalid'))).toThrow(RangeError);
});
