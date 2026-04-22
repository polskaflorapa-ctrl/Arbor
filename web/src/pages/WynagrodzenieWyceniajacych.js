import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import { getApiErrorMessage } from '../utils/apiError';
import { computeEstimatorPayout } from '../utils/computeEstimatorPayout';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';

const LS_RULES = 'arbor_wynagrodzenie_wyceniajacy_reguly_v1';

function loadRules() {
  return getLocalStorageJson(LS_RULES, {});
}

function saveRules(obj) {
  localStorage.setItem(LS_RULES, JSON.stringify(obj));
}

function fmtPln(n) {
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(Number(n) || 0);
}

export default function WynagrodzenieWyceniajacych() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [uzytkownicy, setUzytkownicy] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [msg, setMsg] = useState('');
  const [wybranyId, setWybranyId] = useState('');
  const [rok, setRok] = useState(new Date().getFullYear());
  const [miesiac, setMiesiac] = useState(new Date().getMonth() + 1);
  const [dniRobocze, setDniRobocze] = useState(22);
  const [stawkaDzienna, setStawkaDzienna] = useState(200);
  const [procent, setProcent] = useState(2);
  const [dodatki, setDodatki] = useState(0);
  const [opisDodatkow, setOpisDodatkow] = useState('');
  const [sumaReczna, setSumaReczna] = useState('');
  const [sumaZApi, setSumaZApi] = useState(null);

  const load = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      navigate('/');
      return;
    }
    const u = getLocalStorageJson('user', {});
    setUser(u);
    try {
      const [uRes, zRes] = await Promise.all([
        api.get('/uzytkownicy', { headers: authHeaders(token) }),
        api.get('/tasks/wszystkie', { headers: authHeaders(token) }),
      ]);
      const list = Array.isArray(uRes.data) ? uRes.data : (uRes.data.uzytkownicy || []);
      setUzytkownicy(list);
      const zl = Array.isArray(zRes.data) ? zRes.data : [];
      setTasks(zl);
    } catch (e) {
      setMsg(getApiErrorMessage(e, 'Błąd ładowania'));
    }
  }, [navigate]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (user?.rola === 'Wyceniający' && user.id) {
      setWybranyId(String(user.id));
    }
  }, [user]);

  const wyceniajacy = useMemo(
    () => uzytkownicy.filter((x) => x.rola === 'Wyceniający' || x.rola === 'Kierownik'),
    [uzytkownicy]
  );

  useEffect(() => {
    if (!wybranyId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get(`/wynagrodzenie-wyceniajacy/reguly/${wybranyId}`);
        if (cancelled) return;
        const d = r.data;
        if (d.wynagrodzenie_stawka_dzienna_pln != null) setStawkaDzienna(Number(d.wynagrodzenie_stawka_dzienna_pln));
        if (d.wynagrodzenie_procent_realizacji != null) setProcent(Number(d.wynagrodzenie_procent_realizacji));
        if (d.wynagrodzenie_dodatki_pln != null) setDodatki(Number(d.wynagrodzenie_dodatki_pln));
        if (d.wynagrodzenie_dodatki_opis != null) setOpisDodatkow(String(d.wynagrodzenie_dodatki_opis));
      } catch {
        if (cancelled) return;
        const rules = loadRules();
        const r = rules[wybranyId] || {};
        if (r.stawkaDzienna != null) setStawkaDzienna(r.stawkaDzienna);
        if (r.procent != null) setProcent(r.procent);
        if (r.dodatki != null) setDodatki(r.dodatki);
        if (r.opisDodatkow != null) setOpisDodatkow(r.opisDodatkow);
      }
      try {
        const p = await api.get('/wynagrodzenie-wyceniajacy/podsumowanie', {
          params: { user_id: wybranyId, rok, miesiac, dni_robocze: dniRobocze },
        });
        if (cancelled) return;
        setSumaZApi(Number(p.data?.suma_zrealizowanych_pln) || 0);
      } catch {
        if (!cancelled) setSumaZApi(null);
      }
    })();
    return () => { cancelled = true; };
  }, [wybranyId, rok, miesiac, dniRobocze]);

  const zakresOd = `${rok}-${String(miesiac).padStart(2, '0')}-01`;
  const lastDay = new Date(rok, miesiac, 0).getDate();
  const zakresDo = `${rok}-${String(miesiac).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const sumaZListy = useMemo(() => {
    if (!wybranyId) return 0;
    const id = Number(wybranyId);
    let sum = 0;
    for (const t of tasks) {
      if (t.typ === 'wycena') continue;
      const zakonczone = t.status === 'Zakonczone' || t.status === 'Zakończone';
      if (!zakonczone) continue;
      const wykRaw = t.data_wykonania || t.updated_at || t.created_at;
      const wyk = typeof wykRaw === 'string' ? wykRaw.slice(0, 10) : '';
      if (!wyk || wyk < zakresOd || wyk > zakresDo) continue;
      const byId =
        Number(t.created_by) === id ||
        Number(t.wyceniajacy_id) === id ||
        Number(t.wycenil_id) === id;
      if (!byId) continue;
      sum += parseFloat(t.wartosc_planowana || t.wartosc || 0) || 0;
    }
    return Math.round(sum * 100) / 100;
  }, [tasks, wybranyId, zakresOd, zakresDo]);

  const sumaZrealizowanych =
    sumaReczna !== ''
      ? parseFloat(sumaReczna.replace(',', '.')) || 0
      : (sumaZApi != null ? sumaZApi : sumaZListy);

  const wynik = computeEstimatorPayout({
    stawkaDziennaPln: stawkaDzienna,
    dniRobocze,
    procentOdRealizacji: procent,
    sumaZrealizowanychZlecenPln: sumaZrealizowanych,
    dodatkiStalePln: dodatki,
  });

  const zapiszReguly = async () => {
    if (!wybranyId) return;
    try {
      await api.put(`/wynagrodzenie-wyceniajacy/reguly/${wybranyId}`, {
        wynagrodzenie_stawka_dzienna_pln: stawkaDzienna,
        wynagrodzenie_procent_realizacji: procent,
        wynagrodzenie_dodatki_pln: dodatki,
        wynagrodzenie_dodatki_opis: opisDodatkow || null,
      });
      const all = loadRules();
      all[wybranyId] = { stawkaDzienna, procent, dodatki, opisDodatkow };
      saveRules(all);
      setMsg('Zapisano reguły na serwerze i kopię zapasową w przeglądarce.');
    } catch (e) {
      const all = loadRules();
      all[wybranyId] = { stawkaDzienna, procent, dodatki, opisDodatkow };
      saveRules(all);
      setMsg(getApiErrorMessage(e, 'Brak endpointu PUT — zapisano tylko lokalnie w przeglądarce.'));
    }
  };

  const canSee = user && ['Dyrektor', 'Administrator', 'Kierownik', 'Wyceniający'].includes(user.rola);
  const widziTylkoSiebie = user?.rola === 'Wyceniający';

  if (!canSee) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
        <Sidebar />
        <div style={{ padding: 32 }}>
          <PageHeader title="Rozliczenie wyceniających" subtitle="Brak uprawnień" />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      <Sidebar />
      <div style={{ flex: 1, padding: '20px 24px 40px', overflow: 'auto' }}>
        <PageHeader
          title="Rozliczenie wyceniających"
          subtitle="Stawka dzienna + % od zrealizowanych zleceń (wyceniajacy_id po zatwierdzeniu wyceny) + dodatki. API: backend_routes_arbor_wyceny.js + sql/arbor_wyceny_wynagrodzenie_media.sql"
        />
        <StatusMessage message={msg} />

        <div style={card}>
          <div style={grid}>
            <label style={lab}>Wyceniający</label>
            <select
              style={inp}
              value={wybranyId}
              onChange={(e) => setWybranyId(e.target.value)}
              disabled={widziTylkoSiebie}
            >
              <option value="">— wybierz —</option>
              {(widziTylkoSiebie ? uzytkownicy.filter((u) => u.id === user.id) : wyceniajacy).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.imie} {u.nazwisko} ({u.rola})
                  {u.oddzial_nazwa ? ` · ${u.oddzial_nazwa}` : ''}
                </option>
              ))}
            </select>

            <label style={lab}>Rok / miesiąc (data realizacji zlecenia)</label>
            <div style={{ display: 'flex', gap: 10 }}>
              <input style={inp} type="number" value={rok} onChange={(e) => setRok(Number(e.target.value))} />
              <select style={inp} value={miesiac} onChange={(e) => setMiesiac(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>{i + 1}</option>
                ))}
              </select>
            </div>

            <label style={lab}>Dni robocze w miesiącu</label>
            <input style={inp} type="number" min={0} max={31} value={dniRobocze} onChange={(e) => setDniRobocze(Number(e.target.value))} />

            <label style={lab}>Stawka dzienna (PLN)</label>
            <input style={inp} type="number" min={0} step={1} value={stawkaDzienna} onChange={(e) => setStawkaDzienna(Number(e.target.value))} />

            <label style={lab}>Procent od sumy zrealizowanych</label>
            <input style={inp} type="number" min={0} step={0.1} value={procent} onChange={(e) => setProcent(Number(e.target.value))} />

            <label style={lab}>Dodatki stałe (PLN)</label>
            <input style={inp} type="number" min={0} step={1} value={dodatki} onChange={(e) => setDodatki(Number(e.target.value))} />

            <label style={lab}>Opis dodatków</label>
            <input style={inp} value={opisDodatkow} onChange={(e) => setOpisDodatkow(e.target.value)} placeholder="np. nadzór brygad, serwis aut" />

            <label style={lab}>Suma zleceń ręcznie (opcjonalnie)</label>
            <input
              style={inp}
              value={sumaReczna}
              onChange={(e) => setSumaReczna(e.target.value)}
              placeholder={`Z listy: ${fmtPln(sumaZListy)}`}
            />
          </div>

          <div style={{ marginTop: 20, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" style={btnPri} onClick={zapiszReguly} disabled={!wybranyId}>Zapisz reguły (serwer + lokalnie)</button>
          </div>
        </div>

        <div style={{ ...card, marginTop: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Podsumowanie</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <tbody>
              <tr><td style={tdL}>Część dzienna</td><td style={tdR}>{fmtPln(wynik.czescDzienna)}</td></tr>
              <tr><td style={tdL}>{procent}% × {fmtPln(sumaZrealizowanych)}</td><td style={tdR}>{fmtPln(wynik.czescProcentowa)}</td></tr>
              <tr><td style={tdL}>Dodatki</td><td style={tdR}>{fmtPln(wynik.dodatki)}</td></tr>
              <tr style={{ fontWeight: 800, borderTop: '1px solid var(--border)' }}>
                <td style={tdL}>Razem</td><td style={tdR}>{fmtPln(wynik.razem)}</td></tr>
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12, marginBottom: 0 }}>
            Suma: jeśli działa endpoint podsumowania, używana jest suma po <code>wyceniajacy_id</code> z serwera; inaczej lokalna lista zadań (<code>created_by</code> / <code>wyceniajacy_id</code> / <code>wycenil_id</code>). Pole „Suma ręcznie” ma pierwszeństwo.
          </p>
        </div>
      </div>
    </div>
  );
}

const card = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 20,
  maxWidth: 640,
};
const grid = { display: 'grid', gridTemplateColumns: '200px 1fr', gap: 12, alignItems: 'center' };
const lab = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' };
const inp = {
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg-deep)',
  color: 'var(--text)',
  fontSize: 14,
};
const btnPri = {
  padding: '10px 18px',
  borderRadius: 10,
  border: 'none',
  background: 'var(--accent)',
  color: '#052E16',
  fontWeight: 700,
  cursor: 'pointer',
};
const tdL = { padding: '8px 0', color: 'var(--text-sub)' };
const tdR = { padding: '8px 0', textAlign: 'right', fontWeight: 600 };
