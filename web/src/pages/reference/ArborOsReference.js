import { ArborLogo, Icon, Money, ProgressBar, RefCard, RefSidebar, StatusPill } from './ArborReferenceComponents';

const kpis = [
  ['Aktywne zlecenia', '42', '+8 dzisiaj'],
  ['Ekipy w terenie', '11', '3 w drodze'],
  ['Przychod miesiaca', '486k', 'netto PLN'],
  ['Alerty operacyjne', '5', '2 pilne'],
];

const jobs = [
  ['#1042', 'Pielęgnacja i wycinka - al. Klonowa 5', 'Warszawa', 'W realizacji', '6 800 zł'],
  ['#1043', 'Frezowanie pni i uprzątnięcie', 'Piaseczno', 'Planowane', '3 400 zł'],
  ['#1044', 'Inspekcja po wichurze', 'Kraków', 'Pilne', '2 900 zł'],
  ['#1045', 'Redukcja koron przy drodze', 'Gdańsk', 'Wycena', '8 200 zł'],
];

export default function ArborOsReference() {
  return (
    <div className="ref-page ref-shell">
      <RefSidebar active="Pulpit" />
      <main className="ref-main">
        <header className="ref-topbar">
          <div className="ref-title-block">
            <small>Arbor OS</small>
            <h1>Centrum operacyjne</h1>
            <p>Widok zgodny z eksportem Arbor OS: brązowy sidebar, papierowe tło, zwarte karty i priorytet na szybkie decyzje.</p>
          </div>
          <div className="ref-actions">
            <button className="ref-button" type="button"><Icon name="calendar" /> Grafik</button>
            <button className="ref-button is-primary" type="button"><Icon name="plus" /> Nowe zlecenie</button>
          </div>
        </header>

        <section className="ref-hero-dark" style={{ padding: 28, marginBottom: 18 }}>
          <div className="ref-grid two" style={{ alignItems: 'center' }}>
            <div>
              <small>Dzisiaj, 22 czerwca</small>
              <h2 style={{ margin: '8px 0 10px', fontSize: 'clamp(30px, 4vw, 54px)', lineHeight: 1 }}>Plan dnia jest pod kontrolą</h2>
              <p style={{ maxWidth: 560, margin: 0 }}>Najbliższe okno: ekipa A1 kończy prace na Klonowej, dyspozytor ma 2 alerty do rozstrzygnięcia.</p>
            </div>
            <div className="ref-grid three">
              <div><strong>89%</strong><span>terminowości</span></div>
              <div><strong>14</strong><span>tras</span></div>
              <div><strong>31%</strong><span>marży</span></div>
            </div>
          </div>
        </section>

        <section className="ref-grid kpis" data-kpis>
          {kpis.map(([label, value, hint]) => (
            <div className="ref-kpi" key={label}>
              <small>{label}</small>
              <strong>{value}</strong>
              <span>{hint}</span>
            </div>
          ))}
        </section>

        <div className="ref-grid two" style={{ marginTop: 18 }}>
          <RefCard title="Zlecenia do decyzji">
            <div className="ref-list">
              {jobs.map(([id, title, city, status, value]) => (
                <div className="ref-list-row" key={id}>
                  <div>
                    <strong>{id} · {title}</strong>
                    <small>{city}</small>
                  </div>
                  <StatusPill tone={status === 'Pilne' ? 'red' : status === 'W realizacji' ? 'orange' : 'olive'}>{status}</StatusPill>
                  <Money>{value}</Money>
                </div>
              ))}
            </div>
          </RefCard>

          <RefCard title="Mapa operacyjna">
            <div className="ref-panel" style={{ minHeight: 280, padding: 16, background: '#faf8f1', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(59,42,24,.06) 1px, transparent 1px), linear-gradient(0deg, rgba(59,42,24,.05) 1px, transparent 1px)', backgroundSize: '38px 38px' }} />
              {[
                ['A1', 24, 38, '#a0af14'],
                ['A2', 58, 28, '#bd701e'],
                ['K1', 72, 64, '#456b1f'],
              ].map(([label, x, y, color]) => (
                <span key={label} style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, width: 38, height: 38, display: 'grid', placeItems: 'center', borderRadius: 13, background: color, color: '#fff', fontWeight: 900 }}>{label}</span>
              ))}
            </div>
          </RefCard>
        </div>
      </main>
    </div>
  );
}

export function ArborOsDeckReference() {
  return (
    <div className="ref-deck">
      <ArborLogo sub="Arbor OS Deck" />
      <section className="ref-deck-slide">
        <div>
          <small style={{ color: '#a0af14', fontWeight: 900, letterSpacing: '.14em', textTransform: 'uppercase' }}>Polska Flora</small>
          <h1>Arbor OS porządkuje teren, biuro i finanse.</h1>
          <p>Deck w stylu eksportu: mocny brązowy ekran, duża typografia i konkretne liczby zamiast dekoracji.</p>
        </div>
        <div className="ref-deck-metrics">
          <div className="ref-deck-metric"><strong>42</strong><span>aktywne zlecenia</span></div>
          <div className="ref-deck-metric"><strong>11</strong><span>ekip i specjalistów w terenie</span></div>
          <div className="ref-deck-metric"><strong>486k</strong><span>miesięczny obrót w panelu</span></div>
        </div>
      </section>
    </div>
  );
}
