const { formatSmsPlanParts } = require('../src/services/smsTemplates');

function pad(n) {
  return String(n).padStart(2, '0');
}

function expectedWindowFromStart(start, durationHours) {
  const durMin = Math.max(15, Math.round(Number(durationHours || 2) * 60));
  const end = new Date(start.getTime() + durMin * 60000);
  return `${pad(start.getHours())}:${pad(start.getMinutes())}-${pad(end.getHours())}:${pad(end.getMinutes())}`;
}

describe('formatSmsPlanParts', () => {
  it('uses fallback when brak data_planowana', () => {
    expect(formatSmsPlanParts({}, '15.06.2026')).toEqual({
      dateStr: '15.06.2026',
      windowStr: '8:00-16:00',
    });
    expect(formatSmsPlanParts({ data_planowana: null }, '15.06.2026').windowStr).toBe('8:00-16:00');
  });

  it('liczy koniec okna z czas_planowany_godziny (strefa lokalna hosta)', () => {
    const start = new Date(2026, 5, 15, 9, 30, 0);
    const z = {
      data_planowana: start.toISOString(),
      czas_planowany_godziny: 2,
    };
    const r = formatSmsPlanParts(z, '-');
    expect(r.windowStr).toBe(expectedWindowFromStart(start, 2));
    expect(r.dateStr).toBe(start.toLocaleDateString('pl-PL'));
  });

  it('minimalny slot 15 min', () => {
    const start = new Date(2026, 5, 15, 10, 0, 0);
    const z = {
      data_planowana: start.toISOString(),
      czas_planowany_godziny: 0.25,
    };
    expect(formatSmsPlanParts(z, '-').windowStr).toBe(expectedWindowFromStart(start, 0.25));
  });
});
