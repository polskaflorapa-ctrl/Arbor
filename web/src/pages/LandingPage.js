import { useEffect, useState } from 'react';
import {
  ArrowForward,
  AssignmentTurnedIn,
  CalendarMonth,
  CheckCircle,
  Insights,
  Inventory2,
  Lock,
  Map,
  PhoneInTalk,
  Route,
  Security,
  Timeline,
} from '@mui/icons-material';
import { getReactApiBase } from '../utils/apiBase';
import './LandingPage.css';
import BrandLogo from '../components/BrandLogo';

const DEMO_REQUEST_STORAGE_KEY = 'arbor-landing-demo-requests';

const initialDemoForm = {
  name: '',
  email: '',
  company: '',
  phone: '',
  message: '',
};

const modules = [
  {
    icon: <Route />,
    title: 'Dyspozytornia',
    text: 'Planuj trasy, przydzielaj ekipy i koryguj dzień zanim opóźnienia zaczną się piętrzyć.',
  },
  {
    icon: <PhoneInTalk />,
    title: 'CRM',
    text: 'Prowadź leady, oddzwonki, wyceny i historię klienta w tym samym rytmie pracy.',
  },
  {
    icon: <Inventory2 />,
    title: 'Flota i sprzęt',
    text: 'Kontroluj rezerwacje, przekazania i dostępność bez pobocznych arkuszy.',
  },
  {
    icon: <AssignmentTurnedIn />,
    title: 'Akceptacje',
    text: 'Przepuszczaj wyceny, notatki terenowe, zdjęcia i rozliczenia przez jasne etapy kontroli.',
  },
];

const queueRows = [
  ['08:40', 'Montaż Ogrodowa', 'Ekipa 4', 'W trasie'],
  ['09:15', 'Oględziny magazynu', 'Ekipa 2', 'Do akceptacji'],
  ['10:00', 'Naprawa Północna', 'Ekipa 1', 'Zaplanowane'],
  ['11:30', 'Odbiór sprzętu', 'Ekipa 5', 'Gotowe'],
];

const timeline = [
  { label: 'Zgłoszenie przyjęte', width: '24%' },
  { label: 'Wycena przydzielona', width: '42%' },
  { label: 'Ekipa potwierdzona', width: '66%' },
  { label: 'Raport podpisany', width: '88%' },
];

function readLocalDemoRequests() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DEMO_REQUEST_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalDemoRequests(items) {
  try {
    localStorage.setItem(DEMO_REQUEST_STORAGE_KEY, JSON.stringify(items.slice(0, 20)));
  } catch {
    // Public lead capture must not fail because a browser blocks local backup.
  }
}

function normalizeDemoPayload(payload) {
  const {
    deliveryError,
    retryError,
    retrySyncedAt,
    ...cleanPayload
  } = payload || {};

  return {
    name: cleanPayload.name || '',
    email: cleanPayload.email || '',
    company: cleanPayload.company || '',
    phone: cleanPayload.phone || '',
    message: cleanPayload.message || '',
    source: cleanPayload.source || 'landing-page',
    createdAt: cleanPayload.createdAt || new Date().toISOString(),
  };
}

async function postDemoRequest(payload) {
  const response = await fetch(`${getReactApiBase()}/demo-requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(normalizeDemoPayload(payload)),
  });

  if (!response.ok) {
    throw new Error(`Demo request failed with ${response.status}`);
  }
}

export default function LandingPage() {
  const [demoForm, setDemoForm] = useState(initialDemoForm);
  const [demoStatus, setDemoStatus] = useState('');
  const [demoError, setDemoError] = useState('');
  const [submittingDemo, setSubmittingDemo] = useState(false);

  const updateDemoForm = (field, value) => {
    setDemoForm((current) => ({ ...current, [field]: value }));
    setDemoStatus('');
    setDemoError('');
  };

  const saveLocalDemoRequest = (payload) => {
    try {
      const saved = readLocalDemoRequests();
      writeLocalDemoRequests([payload, ...saved]);
    } catch {
      writeLocalDemoRequests([payload]);
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function replayPendingDemoRequests() {
      const saved = readLocalDemoRequests();
      const pending = saved
        .filter((item) => item?.deliveryError && !item?.retrySyncedAt)
        .slice(0, 3);

      if (pending.length === 0) return;

      let synced = 0;
      const nextItems = [...saved];

      for (const item of pending) {
        const index = nextItems.findIndex((row) => (
          row?.createdAt === item.createdAt
          && row?.email === item.email
          && row?.company === item.company
        ));

        try {
          await postDemoRequest(item);
          synced += 1;
          if (index >= 0) {
            nextItems[index] = {
              ...nextItems[index],
              deliveryError: undefined,
              retryError: undefined,
              retrySyncedAt: new Date().toISOString(),
            };
          }
        } catch (error) {
          if (index >= 0) {
            nextItems[index] = {
              ...nextItems[index],
              retryError: error.message,
            };
          }
        }
      }

      writeLocalDemoRequests(nextItems);
      if (!cancelled && synced > 0) {
        setDemoStatus(`Wyslalismy zalegle zgloszenie demo (${synced}).`);
      }
    }

    replayPendingDemoRequests();

    return () => {
      cancelled = true;
    };
  }, []);

  const submitDemoRequest = async (event) => {
    event.preventDefault();
    setSubmittingDemo(true);
    setDemoStatus('');
    setDemoError('');

    const payload = {
      ...demoForm,
      createdAt: new Date().toISOString(),
      source: 'landing-page',
    };

    try {
      await postDemoRequest(payload);
      saveLocalDemoRequest(payload);
      setDemoForm(initialDemoForm);
      setDemoStatus('Dziękujemy. Zgłoszenie demo zostało wysłane. Oddzwonimy z konkretnym planem rozmowy.');
    } catch (error) {
      saveLocalDemoRequest({ ...payload, deliveryError: error.message });
      setDemoError('Nie udało się wysłać zgłoszenia do API. Spróbuj ponownie za chwilę, a dane zostają zabezpieczone lokalnie w tej przeglądarce.');
    } finally {
      setSubmittingDemo(false);
    }
  };

  return (
    <main className="landing-page">
      <header className="landing-nav" aria-label="Polska Flora">
        <a className="landing-brand" href="#top" aria-label="Polska Flora home">
          <BrandLogo className="landing-brand-logo" alt="Polska Flora" />
        </a>
        <nav>
          <a href="#product">Produkt</a>
          <a href="#operations">Operacje</a>
          <a href="#security">Bezpieczeństwo</a>
          <a href="#pricing">Cennik</a>
        </nav>
        <div className="landing-nav-actions">
          <a className="landing-login" href="#/login">Zaloguj</a>
          <a className="landing-button landing-button-primary" href="#contact">
            Umów demo
          </a>
        </div>
      </header>

      <section className="landing-ops-screen landing-ops-screen-reference" id="top">
        <a className="landing-sr-login" href="#/login">Zaloguj</a>
        <aside className="landing-ops-rail">
          <div className="landing-ops-logo">
            <BrandLogo background="dark" className="landing-ops-logo-img" alt="Polska Flora" />
            <b>«</b>
          </div>
          <div className="landing-ops-branch">
            <strong>Oddzial Katowice</strong>
            <span>M. Kowalski</span>
            <small>Kierownik operacyjny</small>
          </div>
          {[
            ['OPERACJE', 'Centrum operacyjne', 'Zlecenia', 'Planowanie', 'Trasy i mapy', 'Zasoby'],
            ['KLIENCI', 'Firmy', 'Kontakty', 'Szanse'],
            ['SERWIS', 'Zgloszenia', 'Przeglady', 'Umowy'],
            ['ANALITYKA', 'Raporty', 'KPI', 'Eksporty'],
            ['USTAWIENIA', 'Ustawienia', 'Slowniki', 'Integracje'],
          ].map(([group, ...items]) => (
            <div className="landing-ops-nav-group" key={group}>
              <strong>{group}</strong>
              {items.map((item) => (
                <span className={item === 'Centrum operacyjne' ? 'active' : ''} key={item}>
                  <i />
                  {item}
                </span>
              ))}
            </div>
          ))}
        </aside>

        <div className="landing-ops-workspace">
          <header className="landing-ops-header">
            <div>
              <h1>Centrum operacyjne</h1>
              <p>Przeglad operacji w czasie rzeczywistym i planowanie pracy zespolow.</p>
            </div>
            <div className="landing-ops-header-actions">
              <span>21 maj 2025</span>
              <button type="button">Dzisiaj</button>
              <span className="landing-ops-refresh">Auto-odswiezanie <b>30 s</b></span>
              <a className="landing-button landing-button-primary" href="#contact">Nowe zlecenie</a>
              <button type="button">Opcje widoku</button>
            </div>
          </header>

          <div className="landing-ops-kpis">
            <div><i className="ok" /><span>Zespoly w terenie</span><strong>24 / 32</strong><small>75% · 24 aktywne</small></div>
            <div><i className="ok" /><span>Gotowosc tras</span><strong>92%</strong><small>Wszystkie trasy na dzis</small></div>
            <div><i className="warn" /><span>Zlecenia otwarte</span><strong>128</strong><small>+18 od wczoraj</small></div>
            <div><i className="danger" /><span>Zalegle problemy</span><strong>7</strong><small>Wymagaja uwagi</small></div>
          </div>

          <div className="landing-ops-grid">
            <section className="landing-ops-plan">
              <header>
                <strong>Plan dnia - Zespoly i harmonogram</strong>
                <div>
                  <input aria-label="Szukaj zespolu" placeholder="Szukaj zespolu lub pracownika" />
                  <button type="button">Filtry</button>
                  <button type="button">Optymalizuj trasy</button>
                </div>
              </header>
              <div className="landing-ops-time-head">
                <span>Zespol / Pracownicy</span><b>07:00</b><b>09:00</b><b>11:00</b><b>13:00</b><b>15:00</b><b>17:00</b>
              </div>
              {[
                ['Z01', 'Katowice - Polnoc', 'M. Nowak / A. Duda', 'green', ['ZL-2025-3148|Przeglad drzew', '', 'ZL-2025-3151|Wycinka', '', 'ZL-2025-3156|Pielegnacja']],
                ['Z02', 'Katowice - Poludnie', 'P. Zielinski / T. Kaczmarek', 'green', ['', 'ZL-2025-3149|Kontrola', 'ZL-2025-3147|Interwencja', '', 'ZL-2025-3153|Wycinka']],
                ['Z03', 'Gliwice', 'D. Wozniak / K. Lesny', 'green', ['ZL-2025-3152|Pielegnacja', '', 'ZL-2025-3133|Montaz wiazan', '', 'ZL-2025-3149|Przeglad']],
                ['Z04', 'Tychy', 'B. Mazur / S. Jankowski', 'amber', ['ZL-2025-3122|Wycinka', '', 'ZL-2025-3143|Interwencja', '', 'ZL-2025-3154|Pielegnacja']],
                ['Z05', 'Rybnik', 'M. Adamski / L. Gorka', 'red', ['', 'Brak obsady|Brak dostepnych pracownikow', '', '', 'ZL-2025-3150|Przeglad']],
              ].map(([code, city, people, tone, jobs]) => (
                <div className="landing-ops-plan-row" key={code}>
                  <span className={`team-dot ${tone}`} />
                  <span className="team-name"><strong>{code}</strong> {city}<small>{people}</small></span>
                  {jobs.map((job, index) => (
                    job ? (
                      <b className={job.includes('Interwencja') ? 'warn' : job.includes('Brak') ? 'missing' : ''} key={`${code}-${index}`}>
                        {job.split('|')[0]}<small>{job.split('|')[1]}</small>
                      </b>
                    ) : <em key={`${code}-${index}`} />
                  ))}
                </div>
              ))}
              <footer><span>Legenda:</span> Na trasie · W trakcie · Opoznienie · Brak obsady <a href="#product">Pokaz wszystkie zespoly (32)</a></footer>
            </section>

            <section className="landing-ops-map">
              <strong>Podglad mapy - Aktywne zespoly <span>↗</span></strong>
              <div className="landing-ops-map-canvas">
                <span className="pin pin-1">1</span>
                <span className="pin pin-2">4</span>
                <span className="pin pin-3">5</span>
                <b className="map-label l1">Gliwice</b>
                <b className="map-label l2">Katowice</b>
                <b className="map-label l3">Tychy</b>
                <b className="map-label l4">Rybnik</b>
                <em>+<br />-</em>
              </div>
            </section>

            <aside className="landing-ops-side">
              <section>
                <strong>Gotowosc sprzetu <a href="#product">Pokaz wszystkie</a></strong>
                {[
                  ['Podnosniki koszowe', '18 / 21', 86],
                  ['Rebaki', '7 / 8', 88],
                  ['Samochody', '26 / 32', 82],
                  ['Pilarki', '42 / 48', 88],
                  ['Chipery', '5 / 6', 74],
                ].map(([item, value, width], index) => (
                  <p key={item}><span>{item}</span><b>{value}</b><i className={index === 4 ? 'warn' : ''} style={{ width: `${width}%` }}></i></p>
                ))}
                <em>Lacznie: 98% gotowosci</em>
              </section>
              <section>
                <strong>Alerty i powiadomienia <a href="#product">Pokaz wszystkie</a></strong>
                <p className="danger">7 zaleglych problemow <b>10:12</b><small>Wymaga pilnej uwagi</small></p>
                <p className="warn">Interwencja - ZL-2025-3147 <b>10:08</b><small>Opoznienie: 45 min</small></p>
                <p className="warn">Przeglad sprzetu <b>Wczoraj</b><small>2 pozycje do przegladu</small></p>
                <p>Aktualizacja aplikacji mobilnej <b>20.05.2025</b><small>Dostepna nowa wersja</small></p>
              </section>
            </aside>
          </div>

          <div className="landing-ops-tables">
            <section>
              <strong>Kolejka przekazania do CRM <small>12</small></strong>
              {['Zarzad Zieleni M.', 'Spoldzielnia Lesna', 'Park Slaski'].map((client, index) => (
                <p key={client}><span>{client}</span><em>ZL-2025-{3156 - index}</em><b>{index === 1 ? 'Do kontaktu' : 'Do wyceny'}</b></p>
              ))}
            </section>
            <section>
              <strong>Zlecenia otwarte <small>128</small></strong>
              {['Interwencje', 'Wycinka', 'Pielegnacja'].map((item, index) => (
                <p key={item}><span>{item}</span><em>{index === 0 ? 'Katowice, Myslowice' : 'Gliwice, Rybnik'}</em><b>{18 + index * 6}</b></p>
              ))}
            </section>
            <section>
              <strong>Wydajnosc zespolow <a href="#product">Pokaz raport</a></strong>
              {['Z01 Katowice', 'Z02 Katowice', 'Z03 Gliwice'].map((item, index) => (
                <p key={item}><span>{item}</span><em>Plan {8 - index}</em><b>{75 + index * 7}%</b></p>
              ))}
            </section>
          </div>
        </div>

        <aside className="landing-ops-phone">
          <div className="phone-top">10:24 <b>Arbor</b><small>7</small></div>
          <strong>Centrum operacyjne</strong>
          <div><span>24/32<small>Zespoly</small></span><span>92%<small>Trasy</small></span><span>128<small>Zlecenia</small></span><span>7<small>Problemy</small></span></div>
          <h2>Plan dnia - Zespoly</h2>
          {[
            ['Z01 Katowice - Polnoc', '75%', 'ok'],
            ['Z02 Katowice - Poludnie', '89%', 'ok'],
            ['Z03 Gliwice', '71%', 'ok'],
            ['Z04 Tychy', '50%', 'warn'],
            ['Z05 Rybnik', '33%', 'danger'],
          ].map(([team, percent, tone]) => (
            <p className={tone} key={team}>{team}<small>{percent}</small></p>
          ))}
        </aside>
      </section>

      <section className="landing-hero" aria-hidden="true">
        <div className="landing-hero-copy">
          <h1>Prowadź operacje terenowe z jednego spokojnego centrum dowodzenia</h1>
          <p>
            Polska Flora łączy dyspozytornię, CRM, ekipy, flotę i raporty, żeby każde zlecenie szło
            do przodu bez ciągłego poganiania.
          </p>
          <div className="landing-hero-actions">
            <a className="landing-button landing-button-primary" href="#contact">
              Umów demo
              <ArrowForward fontSize="small" />
            </a>
            <a className="landing-button landing-button-secondary" href="#product">
              Zobacz produkt
            </a>
          </div>
        </div>

        <div className="landing-product-shell" aria-label="Podgląd systemu Polska Flora">
          <div className="landing-product-topbar">
            <span></span>
            <strong>Operacje dzisiaj</strong>
            <small>Na żywo</small>
          </div>
          <div className="landing-product-grid">
            <section className="landing-map-panel" aria-label="Mapa dyspozytorni na żywo">
              <div className="landing-map-path"></div>
              <span className="landing-map-pin pin-a"></span>
              <span className="landing-map-pin pin-b"></span>
              <span className="landing-map-pin pin-c"></span>
              <div className="landing-map-card">
                <Map fontSize="small" />
                18 aktywnych zleceń
              </div>
            </section>
            <section className="landing-queue-panel" aria-label="Kolejka zleceń">
              <div className="landing-panel-heading">
                <span>Kolejka zleceń</span>
                <strong>94%</strong>
              </div>
              {queueRows.map(([time, job, team, status]) => (
                <div className="landing-queue-row" key={job}>
                  <time>{time}</time>
                  <span>{job}</span>
                  <small>{team}</small>
                  <em>{status}</em>
                </div>
              ))}
            </section>
            <section className="landing-kpi-strip" aria-label="Metryki dzienne">
              <div>
                <span>Przychód pod kontrolą</span>
                <strong>192 tys. zł</strong>
              </div>
              <div>
                <span>Ryzyko opóźnień</span>
                <strong>3 zlecenia</strong>
              </div>
              <div>
                <span>Obłożenie ekip</span>
                <strong>82%</strong>
              </div>
            </section>
          </div>
        </div>
      </section>

      <section className="landing-workflow" id="product">
        <div className="landing-section-copy">
          <h2>Każde zlecenie ma jedno źródło prawdy</h2>
          <p>
            Od pierwszego telefonu po podpisany raport Polska Flora pokazuje ten sam wątek sprzedaży,
            biuru, ekipom terenowym i zarządowi.
          </p>
        </div>
        <div className="landing-workflow-track">
          {timeline.map((step) => (
            <div className="landing-workflow-step" key={step.label}>
              <span style={{ width: step.width }}></span>
              <CheckCircle fontSize="small" />
              <strong>{step.label}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-modules" id="operations">
        <div className="landing-section-copy">
          <h2>Dla operatorów, którzy skanują, decydują i działają</h2>
          <p>
            Produkt stawia na gęste, czytelne ekrany pracy zamiast hałaśliwych dashboardów,
            żeby zespół mógł działać bez otwierania pięciu narzędzi.
          </p>
        </div>
        <div className="landing-module-grid">
          {modules.map((module) => (
            <article className="landing-module" key={module.title}>
              <span>{module.icon}</span>
              <h3>{module.title}</h3>
              <p>{module.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-proof">
        <div>
          <strong>31%</strong>
          <span>mniej zmian planu tego samego dnia</span>
        </div>
        <div>
          <strong>6,4h</strong>
          <span>oszczędzone tygodniowo na koordynatora</span>
        </div>
        <div>
          <strong>99.9%</strong>
          <span>pokrycia ścieżką audytu</span>
        </div>
      </section>

      <section className="landing-security" id="security">
        <div className="landing-security-visual" aria-hidden="true">
          <Security />
          <div>
            <span>Polityka ról</span>
            <span>Dziennik akceptacji</span>
            <span>Eksport danych</span>
          </div>
        </div>
        <div className="landing-section-copy">
          <h2>Kontrola, która rośnie razem z oddziałami</h2>
          <p>
            Uprawnienia oddziałowe, historia aktywności, uporządkowane eksporty i punkty akceptacji
            pomagają rosnąć bez utraty dyscypliny operacyjnej.
          </p>
          <ul>
            <li><Lock fontSize="small" /> Przestrzenie pracy dla biura, ekip, kierowników i finansów.</li>
            <li><Timeline fontSize="small" /> Pełna historia zlecenia w CRM, harmonogramie, dokumentach i rozliczeniu.</li>
            <li><Insights fontSize="small" /> Raporty zarządcze zgodne z codzienną rzeczywistością operacyjną.</li>
          </ul>
        </div>
      </section>

      <section className="landing-pricing" id="pricing">
        <div className="landing-section-copy">
          <h2>Zacznij od centrum dowodzenia. Rozwijaj według procesów.</h2>
          <p>
            Polska Flora jest przygotowana dla rosnących firm usługowych, które potrzebują dyspozytorni,
            CRM, pracy mobilnej i raportowania w jednym systemie operacyjnym.
          </p>
        </div>
        <form className="landing-price-panel landing-demo-form" id="contact" onSubmit={submitDemoRequest}>
          <CalendarMonth />
          <strong>Umów demo Polska Flora</strong>
          <span>Opisz firmę i procesy, a zespół Polska Flora przygotuje rozmowę pod Twoje operacje.</span>
          <div className="landing-form-grid">
            <label>
              Imię i nazwisko
              <input
                type="text"
                value={demoForm.name}
                onChange={(event) => updateDemoForm('name', event.target.value)}
                placeholder="Jan Kowalski"
                required
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={demoForm.email}
                onChange={(event) => updateDemoForm('email', event.target.value)}
                placeholder="jan@firma.pl"
                required
              />
            </label>
            <label>
              Firma
              <input
                type="text"
                value={demoForm.company}
                onChange={(event) => updateDemoForm('company', event.target.value)}
                placeholder="Nazwa firmy"
                required
              />
            </label>
            <label>
              Telefon
              <input
                type="tel"
                value={demoForm.phone}
                onChange={(event) => updateDemoForm('phone', event.target.value)}
                placeholder="+48 600 000 000"
              />
            </label>
            <label className="landing-form-wide">
              Co chcesz uporządkować?
              <textarea
                value={demoForm.message}
                onChange={(event) => updateDemoForm('message', event.target.value)}
                placeholder="Dyspozytornia, CRM, ekipy, flota, raporty..."
                rows="3"
              />
            </label>
          </div>
          <button className="landing-button landing-button-primary" type="submit" disabled={submittingDemo}>
            {submittingDemo ? 'Wysyłanie...' : 'Wyślij zgłoszenie'}
          </button>
          {demoStatus ? <p className="landing-form-status" role="status">{demoStatus}</p> : null}
          {demoError ? <p className="landing-form-status landing-form-status-error" role="alert">{demoError}</p> : null}
        </form>
      </section>

      <footer className="landing-footer">
        <span>Polska Flora</span>
        <span>Operacje terenowe bez codziennego poganiania.</span>
      </footer>
    </main>
  );
}
