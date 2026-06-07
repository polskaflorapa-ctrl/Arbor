jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/config/logger', () => ({
  warn: jest.fn(),
}));

const pool = require('../src/config/database');
const {
  appendCrmMessageForContact,
  createLeadForContact,
  findLeadForContact,
} = require('../src/services/crmInbox');

describe('crmInbox contact routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  test('finds an existing lead by normalized phone in branch scope', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 22 }] });

    await expect(findLeadForContact({
      oddzialId: 7,
      phone: '+48 500 100 200',
    })).resolves.toEqual({ id: 22 });

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("regexp_replace(COALESCE(l.phone, ''), '\\D', '', 'g')"),
      [7, '48500100200']
    );
  });

  test('creates a lead for a new phone contact when explicitly enabled', async () => {
    pool.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM crm_leads')) return { rows: [] };
      if (text.includes('INSERT INTO crm_leads')) return { rows: [{ id: 101 }] };
      if (text.includes('INSERT INTO crm_lead_messages')) {
        return {
          rows: [{
            id: 501,
            lead_id: 101,
            channel: 'phone',
            body: 'Notatka rozmowy',
          }],
        };
      }
      return { rows: [] };
    });

    const message = await appendCrmMessageForContact({
      oddzialId: 7,
      phone: '+48500100200',
      channel: 'phone',
      direction: 'inbound',
      body: 'Notatka rozmowy',
      status: 'received',
      createLeadIfMissing: true,
      source: 'telefon',
      createdBy: 9,
    });

    expect(message).toEqual(expect.objectContaining({ id: 501, lead_id: 101 }));
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO crm_leads'),
      expect.arrayContaining(['Telefon: +48500100200', 7, 'telefon', '+48500100200'])
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO crm_lead_messages'),
      expect.arrayContaining([101, 'phone', 'inbound'])
    );
  });

  test('does not create a lead without branch id', async () => {
    await expect(createLeadForContact({
      phone: '+48500100200',
      channel: 'phone',
      source: 'telefon',
    })).resolves.toBeNull();

    expect(pool.query).not.toHaveBeenCalled();
  });
});
