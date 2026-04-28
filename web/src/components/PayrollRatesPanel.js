import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { getApiErrorMessage } from '../utils/apiError';

const s = {
  card: {
    backgroundColor: 'var(--bg-card)',
    borderRadius: 12,
    padding: '16px 18px',
    marginBottom: 16,
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  },
  title: { fontSize: 15, fontWeight: 700, color: 'var(--accent)', marginBottom: 12 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 6px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' },
  td: { padding: '8px 6px', borderBottom: '1px solid var(--border)' },
  gray: { color: 'var(--text-muted)', fontSize: 13, margin: 0 },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginTop: 12 },
  label: { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 },
  input: { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, backgroundColor: 'var(--bg)' },
  btnRow: { display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  btnPrimary: { padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 },
  err: { color: 'var(--danger)', fontSize: 13, marginTop: 8 },
};

/**
 * F11.1 — historia `user_payroll_rates` + dodanie wersji (POST /payroll/rates).
 * @param {{ userId: number, allowEdit: boolean, onMessage?: (text: string, type?: string) => void }} props
 */
export default function PayrollRatesPanel({ userId, allowEdit, onMessage }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    effective_from: new Date().toISOString().slice(0, 10),
    rate_pln_per_hour: '',
    role_scope: 'pomocnik',
    weekend_multiplier: '',
    night_multiplier: '',
    holiday_multiplier: '',
    alpine_addon_pln: '',
  });

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setErr('');
    try {
      const token = getStoredToken();
      const { data } = await api.get(`/payroll/rates/user/${userId}`, { headers: authHeaders(token) });
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setRows([]);
      if (e.response?.status === 403) {
        setErr('Brak dostępu do stawek rozliczeń.');
      } else if (e.response?.status === 503) {
        setErr('Backend wymaga migracji M11 (user_payroll_rates).');
      } else {
        setErr(getApiErrorMessage(e, 'Nie udało się wczytać stawek.'));
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    const rate = parseFloat(String(form.rate_pln_per_hour).replace(',', '.'), 10);
    if (!Number.isFinite(rate) || rate <= 0) {
      onMessage?.('Podaj dodatnią stawkę PLN/h.', 'error');
      return;
    }
    setSaving(true);
    try {
      const token = getStoredToken();
      const body = {
        user_id: userId,
        effective_from: form.effective_from || undefined,
        rate_pln_per_hour: rate,
        role_scope: form.role_scope || 'pomocnik',
      };
      const wm = parseFloat(String(form.weekend_multiplier).replace(',', '.'), 10);
      const nm = parseFloat(String(form.night_multiplier).replace(',', '.'), 10);
      const hm = parseFloat(String(form.holiday_multiplier).replace(',', '.'), 10);
      const aa = parseFloat(String(form.alpine_addon_pln).replace(',', '.'), 10);
      if (Number.isFinite(wm)) body.weekend_multiplier = wm;
      if (Number.isFinite(nm)) body.night_multiplier = nm;
      if (Number.isFinite(hm)) body.holiday_multiplier = hm;
      if (Number.isFinite(aa)) body.alpine_addon_pln = aa;

      await api.post('/payroll/rates', body, { headers: authHeaders(token) });
      onMessage?.('Zapisano nową stawkę rozliczeń.', 'success');
      setForm((f) => ({
        ...f,
        rate_pln_per_hour: '',
        weekend_multiplier: '',
        night_multiplier: '',
        holiday_multiplier: '',
        alpine_addon_pln: '',
      }));
      await load();
    } catch (e) {
      onMessage?.(getApiErrorMessage(e, 'Błąd zapisu stawki'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={s.card}>
      <div style={s.title}>📊 Stawki rozliczeń (dniówka / M11)</div>
      {loading ? (
        <p style={s.gray}>Ładowanie…</p>
      ) : err ? (
        <p style={s.err}>{err}</p>
      ) : rows.length === 0 ? (
        <p style={s.gray}>Brak wpisów w `user_payroll_rates` — dodaj pierwszą stawkę, aby raport dnia mógł naliczać wynagrodzenie.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Od (data)</th>
                <th style={s.th}>PLN/h</th>
                <th style={s.th}>Zakres</th>
                <th style={s.th}>× weekend</th>
                <th style={s.th}>× noc</th>
                <th style={s.th}>× święto</th>
                <th style={s.th}>Alpina PLN</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={s.td}>{r.effective_from ? String(r.effective_from).slice(0, 10) : '—'}</td>
                  <td style={s.td}>{r.rate_pln_per_hour}</td>
                  <td style={s.td}>{r.role_scope}</td>
                  <td style={s.td}>{r.weekend_multiplier}</td>
                  <td style={s.td}>{r.night_multiplier}</td>
                  <td style={s.td}>{r.holiday_multiplier}</td>
                  <td style={s.td}>{r.alpine_addon_pln}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {allowEdit && (
        <>
          <p style={{ ...s.gray, marginTop: 16, marginBottom: 0 }}>
            Nowa wersja stawki (obowiązuje od wybranej daty; starsze wpisy pozostają w historii).
          </p>
          <div style={s.formGrid}>
            <div>
              <label style={s.label}>Obowiązuje od</label>
              <input
                style={s.input}
                type="date"
                value={form.effective_from}
                onChange={(e) => setForm({ ...form, effective_from: e.target.value })}
              />
            </div>
            <div>
              <label style={s.label}>Stawka PLN/h *</label>
              <input
                style={s.input}
                inputMode="decimal"
                placeholder="np. 35"
                value={form.rate_pln_per_hour}
                onChange={(e) => setForm({ ...form, rate_pln_per_hour: e.target.value })}
              />
            </div>
            <div>
              <label style={s.label}>Zakres roli</label>
              <select style={s.input} value={form.role_scope} onChange={(e) => setForm({ ...form, role_scope: e.target.value })}>
                <option value="pomocnik">pomocnik</option>
                <option value="brygadzista">brygadzista</option>
                <option value="specjalista">specjalista</option>
              </select>
            </div>
            <div>
              <label style={s.label}>× weekend (opcj.)</label>
              <input
                style={s.input}
                placeholder="domyślnie 1.25"
                value={form.weekend_multiplier}
                onChange={(e) => setForm({ ...form, weekend_multiplier: e.target.value })}
              />
            </div>
            <div>
              <label style={s.label}>× noc (opcj.)</label>
              <input
                style={s.input}
                placeholder="domyślnie 1.15"
                value={form.night_multiplier}
                onChange={(e) => setForm({ ...form, night_multiplier: e.target.value })}
              />
            </div>
            <div>
              <label style={s.label}>× święto (opcj.)</label>
              <input
                style={s.input}
                placeholder="domyślnie 1.5"
                value={form.holiday_multiplier}
                onChange={(e) => setForm({ ...form, holiday_multiplier: e.target.value })}
              />
            </div>
            <div>
              <label style={s.label}>Alpina PLN (opcj.)</label>
              <input
                style={s.input}
                placeholder="0"
                value={form.alpine_addon_pln}
                onChange={(e) => setForm({ ...form, alpine_addon_pln: e.target.value })}
              />
            </div>
          </div>
          <div style={s.btnRow}>
            <button type="button" style={s.btnPrimary} disabled={saving} onClick={() => void submit()}>
              {saving ? 'Zapisywanie…' : 'Dodaj wersję stawki'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
