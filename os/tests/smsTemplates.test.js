const {
  formatSmsPlanParts,
  renderSmsStatusTemplate,
  renderTemplate,
  templateFields,
} = require('../src/services/smsTemplates');

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

describe('SMS status templates', () => {
  it('renders variables for task status templates', () => {
    const task = {
      id: 15,
      klient_nazwa: 'Anna',
      typ_uslugi: 'Wycinka',
      adres: 'Lesna 3',
      miasto: 'Krakow',
      link_statusowy_token: 'tok_12345678901234567890',
      oddzial_telefon: '+48123123123',
      data_planowana: new Date(2026, 5, 15, 9, 0, 0).toISOString(),
      czas_planowany_godziny: 2,
    };

    const fields = templateFields(task, {});
    const body = renderTemplate('Klient {{client_name}}, {{service}}, {{address}}, {{status_url}}', fields);

    expect(body).toContain('Anna');
    expect(body).toContain('Wycinka');
    expect(body).toContain('Lesna 3, Krakow');
    expect(body).toContain('/track/tok_12345678901234567890');
  });

  it('prefers branch configured template over default', async () => {
    const pool = {
      query: jest.fn(async (sql) => {
        const text = String(sql);
        if (text.startsWith('CREATE TABLE') || text.startsWith('CREATE UNIQUE INDEX') || text.startsWith('CREATE INDEX')) {
          return { rows: [], rowCount: 0 };
        }
        if (text.includes('FROM sms_status_templates')) {
          return {
            rows: [{ id: 1, body: 'Oddzial {{branch_name}}: {{service}} {{status_url}}' }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const rendered = await renderSmsStatusTemplate(pool, {
      templateKey: 'zaplanowane',
      task: {
        id: 5,
        oddzial_id: 2,
        oddzial_nazwa: 'Krakow',
        typ_uslugi: 'Pielegnacja',
        link_statusowy_token: 'tok_cfg_12345678901234567890',
      },
    });

    expect(rendered.source).toBe('configured');
    expect(rendered.body).toBe('Oddzial Krakow: Pielegnacja /track/tok_cfg_12345678901234567890');
  });
});
