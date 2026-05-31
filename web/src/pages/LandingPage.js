import { useState } from 'react';
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
    const saved = JSON.parse(localStorage.getItem(DEMO_REQUEST_STORAGE_KEY) || '[]');
    localStorage.setItem(DEMO_REQUEST_STORAGE_KEY, JSON.stringify([payload, ...saved].slice(0, 20)));
  };

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
      const response = await fetch(`${getReactApiBase()}/demo-requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Demo request failed with ${response.status}`);
      }

      saveLocalDemoRequest(payload);
      setDemoForm(initialDemoForm);
      setDemoStatus('Dziękujemy. Zgłoszenie demo zostało wysłane.');
    } catch (error) {
      saveLocalDemoRequest({ ...payload, deliveryError: error.message });
      setDemoError('Nie udało się wysłać zgłoszenia do API. Zapisaliśmy je lokalnie w tej przeglądarce.');
    } finally {
      setSubmittingDemo(false);
    }
  };

  return (
    <main className="landing-page">
      <header className="landing-nav" aria-label="Arbor OS">
        <a className="landing-brand" href="#top" aria-label="Arbor OS home">
          <span className="landing-brand-mark">A</span>
          <span>Arbor OS</span>
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

      <section className="landing-hero" id="top">
        <div className="landing-hero-copy">
          <h1>Prowadź operacje terenowe z jednego spokojnego centrum dowodzenia</h1>
          <p>
            Arbor OS łączy dyspozytornię, CRM, ekipy, flotę i raporty, żeby każde zlecenie szło
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

        <div className="landing-product-shell" aria-label="Podgląd produktu Arbor OS">
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
            Od pierwszego telefonu po podpisany raport Arbor pokazuje ten sam wątek sprzedaży,
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
            Arbor OS jest przygotowany dla rosnących firm usługowych, które potrzebują dyspozytorni,
            CRM, pracy mobilnej i raportowania w jednym systemie operacyjnym.
          </p>
        </div>
        <form className="landing-price-panel landing-demo-form" id="contact" onSubmit={submitDemoRequest}>
          <CalendarMonth />
          <strong>Umów demo Arbor OS</strong>
          <span>Opisz firmę i procesy, a zespół Arbor przygotuje rozmowę pod Twoje operacje.</span>
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
        <span>Arbor OS</span>
        <span>Operacje terenowe bez codziennego poganiania.</span>
      </footer>
    </main>
  );
}
