import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Save } from 'lucide-react';
import api from '../api';
import CommandSidebar from '../components/CommandSidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import ModernDataRow from '../components/ModernDataRow';
import { Button } from '../components/ui/Button';
import { getApiErrorMessage } from '../utils/apiError';
import { computeEstimatorPayout } from '../utils/computeEstimatorPayout';
import { computeEstimatorMonth, filterQuotesForEstimatorRole, resolveEstimatorContract } from '../utils/estimatorCompensation';
import { getRoleDisplayName } from '../utils/roleDisplay';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { isTaskDone } from '../utils/taskWorkflow';

function currentYm() {
  return new Date().toISOString().slice(0, 7);
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.toISOString().slice(0, 7);
}

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
  const [contractMonthYm, setContractMonthYm] = useState(currentYm);
  const [contractWorkingDays, setContractWorkingDays] = useState('22');
  const [wyceny, setWyceny] = useState([]);

  const load = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      navigate('/');
      return;
    }
    const u = getLocalStorageJson('user', {});
    setUser(u);
    try {
      const [uRes, zRes, wRes] = await Promise.all([
        api.get('/uzytkownicy', { headers: authHeaders(token) }),
        api.get('/tasks/wszystkie', { headers: authHeaders(token) }),
        api.get('/wyceny', { headers: authHeaders(token) }).catch(() => ({ data: [] })),
      ]);
      const list = Array.isArray(uRes.data) ? uRes.data : (uRes.data.uzytkownicy || []);
      setUzytkownicy(list);
      const zl = Array.isArray(zRes.data) ? zRes.data : [];
      setTasks(zl);
      const wl = Array.isArray(wRes.data) ? wRes.data : [];
      setWyceny(wl);
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
      if (!isTaskDone(t.status)) continue;
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

  // --- Sekcja kontraktowa (wyceniajacy-finanse parity) ---
  const selectedUser = useMemo(
    () => uzytkownicy.find((u) => String(u.id) === wybranyId) || null,
    [uzytkownicy, wybranyId],
  );
  const contract = useMemo(
    () => resolveEstimatorContract(selectedUser?.oddzial_id, selectedUser?.login),
    [selectedUser],
  );
  const contractWd = Math.max(0, parseInt(contractWorkingDays.replace(/\D/g, ''), 10) || 0);
  const contractFilteredQuotes = useMemo(
    () => wybranyId ? filterQuotesForEstimatorRole(wyceny, wybranyId, selectedUser?.rola) : [],
    [wyceny, wybranyId, selectedUser?.rola],
  );
  const contractResult = useMemo(
    () => computeEstimatorMonth(contract, contractFilteredQuotes, wybranyId, contractMonthYm, contractWd),
    [contract, contractFilteredQuotes, wybranyId, contractMonthYm, contractWd],
  );

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

  const canSee = user && ['Prezes', 'Dyrektor', 'Kierownik', 'Wyceniający'].includes(user.rola);
  const widziTylkoSiebie = user?.rola === 'Wyceniający';

  if (!canSee) {
    return (
      <div className="estimator-pay-shell" style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
        <CommandSidebar active="reports" />
        <div className="estimator-pay-main" style={{ padding: 32 }}>
          <PageHeader title="Rozliczenie specjalistów ds. wyceny" subtitle="Brak uprawnień" />
        </div>
      </div>
    );
  }

  return (
    <div className="estimator-pay-shell" style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      <CommandSidebar active="reports" />
      <div className="estimator-pay-main" style={{ flex: 1, padding: '20px 24px 40px', overflow: 'auto' }}>
        <PageHeader
          title="Rozliczenie specjalistów ds. wyceny"
          subtitle="Stawka dzienna + % od zrealizowanych zleceń (wyceniajacy_id po zatwierdzeniu wyceny) + dodatki. API: backend_routes_arbor_wyceny.js + sql/arbor_wyceny_wynagrodzenie_media.sql"
        />
        <StatusMessage message={msg} />

        <div className="estimator-pay-card estimator-pay-config" style={card}>
          <div className="estimator-pay-grid" style={grid}>
            <label style={lab}>Specjalista ds. wyceny</label>
            <select
              style={inp}
              value={wybranyId}
              onChange={(e) => setWybranyId(e.target.value)}
              disabled={widziTylkoSiebie}
            >
              <option value="">— wybierz —</option>
              {(widziTylkoSiebie ? uzytkownicy.filter((u) => u.id === user.id) : wyceniajacy).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.imie} {u.nazwisko} ({getRoleDisplayName(u.rola)})
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

          <div className="estimator-pay-actions" style={{ marginTop: 20, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button style={btnPri} leftIcon={Save} onClick={zapiszReguly} disabled={!wybranyId}>Zapisz reguły (serwer + lokalnie)</Button>
          </div>
        </div>

        {/* ===== Sekcja kontraktowa (wyceniajacy-finanse parity) ===== */}
        {wybranyId && (
          <div className="estimator-pay-card estimator-pay-contract" style={{ ...card, marginTop: 16 }}>
            <div className="estimator-pay-card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>Prowizje — widok kontraktowy</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Button size="sm" style={{ ...btnPri, padding: '6px 12px', fontSize: 13 }} leftIcon={ChevronLeft} onClick={() => setContractMonthYm((m) => shiftMonth(m, -1))} aria-label="Poprzedni miesiac" />
                <span style={{ fontWeight: 700, fontSize: 15, minWidth: 88, textAlign: 'center' }}>{contractMonthYm}</span>
                <Button size="sm" style={{ ...btnPri, padding: '6px 12px', fontSize: 13 }} leftIcon={ChevronRight} onClick={() => setContractMonthYm((m) => shiftMonth(m, 1))} aria-label="Nastepny miesiac" />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
              <label style={lab}>Dni robocze (kontraktowe)</label>
              <input
                style={{ ...inp, maxWidth: 80 }}
                type="number"
                min={0}
                max={31}
                value={contractWorkingDays}
                onChange={(e) => setContractWorkingDays(e.target.value)}
              />
            </div>

            {!contract ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
                Brak umowy kontraktowej dla tego specjalisty ds. wyceny w tabeli <code>WYCENIAJACY_UMOWY</code> (oddział ID: {selectedUser?.oddzial_id ?? '—'}, login: {selectedUser?.login ?? '—'}).
                Uzupełnij <code>web/src/constants/wyceniajacyUmowy.js</code>.
              </p>
            ) : (
              <>
                <div style={{ background: 'var(--surface-field)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{contract.displayName}</div>
                  <div style={{ color: 'var(--text-muted)' }}>
                    Stawka dzienna: <strong>{fmtPln(contract.dailyBasePln)}</strong>
                    {' · '}
                    Prowizja: <strong>{(contract.percentRealized * 100).toFixed(2)}%</strong>
                    {' · '}
                    Kalendarz: <strong>{contract.calendarMode === 'own' ? 'własny' : 'wspólny brygady'}</strong>
                  </div>
                  {contract.addons.length > 0 && (
                    <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                      Addony: {contract.addons.map((a) => `${a.label} ${fmtPln(a.monthlyFixedPln ?? 0)}`).join(' · ')}
                    </div>
                  )}
                </div>

                {contractResult.lines.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
                    Brak wycen ze statusem {contract.quoteStatusesForCommission.join('/')} w miesiącu {contractMonthYm} dla tej osoby.
                  </p>
                ) : (
                  <div className="modern-data-stack" style={{ marginBottom: 12 }}>
                    {contractResult.lines.map((line) => (
                      <ModernDataRow
                        key={String(line.wycenaId)}
                        idLabel="Quote ID"
                        idValue={`#${line.wycenaId}`}
                        title={line.client}
                        subtitle={line.status}
                        tone="success"
                        status="COMMISSION"
                        statusValue="success"
                        statusState="success"
                        metrics={[
                          { label: 'Podstawa', value: fmtPln(line.basisPln) },
                          { label: 'Prowizja', value: `+${fmtPln(line.commissionPln)}`, tone: 'success' },
                        ]}
                      />
                    ))}
                  </div>
                )}

                <div className="modern-data-stack">
                  {[
                    { label: `Część dzienna (${contractResult.workingDays} × ${fmtPln(contract.dailyBasePln)})`, value: fmtPln(contractResult.baseFromDaysPln) },
                    { label: `${(contract.percentRealized * 100).toFixed(2)}% × ${fmtPln(contractResult.totalRealizedBasisPln)}`, value: fmtPln(contractResult.variableFromPercentPln) },
                    ...(contractResult.addonsPln > 0 ? [{ label: 'Addony stałe', value: fmtPln(contractResult.addonsPln) }] : []),
                    { label: 'Razem (kontraktowe)', value: fmtPln(contractResult.totalPln), tone: 'success' },
                  ].map((row) => (
                    <ModernDataRow
                      key={row.label}
                      idLabel="Contract Calc"
                      idValue="PAYOUT"
                      title={row.label}
                      tone={row.tone || 'info'}
                      status={row.tone ? 'TOTAL' : 'CALC'}
                      statusValue={row.tone || 'info'}
                      statusState={row.tone || 'info'}
                      metrics={[{ label: 'Kwota', value: row.value, tone: row.tone }]}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div className="estimator-pay-card estimator-pay-summary" style={{ ...card, marginTop: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Podsumowanie</h3>
          <div className="modern-data-stack">
            {[
              { label: 'Część dzienna', value: fmtPln(wynik.czescDzienna) },
              { label: `${procent}% × ${fmtPln(sumaZrealizowanych)}`, value: fmtPln(wynik.czescProcentowa) },
              { label: 'Dodatki', value: fmtPln(wynik.dodatki) },
              { label: 'Razem', value: fmtPln(wynik.razem), tone: 'success' },
            ].map((row) => (
              <ModernDataRow
                key={row.label}
                idLabel="Summary"
                idValue="EST-PAY"
                title={row.label}
                tone={row.tone || 'info'}
                status={row.tone ? 'TOTAL' : 'CALC'}
                statusValue={row.tone || 'info'}
                statusState={row.tone || 'info'}
                metrics={[{ label: 'Kwota', value: row.value, tone: row.tone }]}
              />
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12, marginBottom: 0 }}>
            Suma: jeśli działa endpoint podsumowania, używana jest suma po <code>wyceniajacy_id</code> z serwera; inaczej lokalna lista zadań (<code>created_by</code> / <code>wyceniajacy_id</code> / <code>wycenil_id</code>). Pole „Suma ręcznie” ma pierwszeństwo.
          </p>
        </div>
      </div>
    </div>
  );
}

const card = {
  background: 'var(--surface-glass)',
  border: '1px solid var(--glass-border)',
  borderRadius: 8,
  boxShadow: 'var(--shadow-md)',
  padding: 20,
  maxWidth: 640,
};
const grid = { display: 'grid', gridTemplateColumns: '200px 1fr', gap: 12, alignItems: 'center' };
const lab = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' };
const inp = {
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--surface-field)',
  color: 'var(--text)',
  fontSize: 14,
};
const btnPri = {
  padding: '10px 18px',
  borderRadius: 8,
  border: '1px solid rgba(20,131,79,0.24)',
  background: 'var(--accent-gradient)',
  color: 'var(--on-accent)',
  fontWeight: 700,
  cursor: 'pointer',
};
