const { isPlPublicHoliday } = require('../src/lib/plPublicHolidays');

describe('plPublicHolidays', () => {
  test('fixed holidays', () => {
    expect(isPlPublicHoliday('2026-01-01')).toBe(true);
    expect(isPlPublicHoliday('2026-01-06')).toBe(true);
    expect(isPlPublicHoliday('2026-05-01')).toBe(true);
    expect(isPlPublicHoliday('2026-05-03')).toBe(true);
    expect(isPlPublicHoliday('2026-12-25')).toBe(true);
  });

  test('ordinary weekday not holiday', () => {
    expect(isPlPublicHoliday('2026-03-10')).toBe(false);
  });

  test('Easter Monday 2026', () => {
    expect(isPlPublicHoliday('2026-04-06')).toBe(true);
  });
});
