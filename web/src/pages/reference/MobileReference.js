import { ArborLogo, Icon, ProgressBar, RefCard, StatusPill } from './ArborReferenceComponents';

const jobs = [
  ['#101', 'Wspólnota Leśna', 'ul. Leśna 14', '08:00-10:00', 'W drodze'],
  ['#102', 'Hotel Park', 'ul. Ogrodowa 12', '11:00-13:00', 'Planowane'],
  ['#103', 'Spółdzielnia Bryza', 'ul. Brzozowa 8', '14:30-16:00', 'Pilne'],
];

export default function MobileReference() {
  return (
    <div className="ref-mobile-wrap">
      <div className="ref-phone" role="img" aria-label="Podgląd Arbor Mobile">
        <div className="ref-phone-screen">
          <header className="ref-phone-top">
            <ArborLogo sub="Arbor Mobile" />
            <StatusPill tone="green">Online</StatusPill>
          </header>

          <main className="ref-phone-content">
            <section className="ref-hero-dark" style={{ padding: 20 }}>
              <small>Misja dnia</small>
              <h1 style={{ margin: '8px 0 6px', fontSize: 28, lineHeight: 1 }}>3 zlecenia · 34 km</h1>
              <p style={{ margin: 0 }}>Następny start: 08:00 · Wspólnota Leśna</p>
              <div style={{ marginTop: 16 }}><ProgressBar value={42} /></div>
            </section>

            <div className="ref-grid three" style={{ gap: 10 }}>
              <div className="ref-kpi"><small>Dzisiaj</small><strong>3</strong><span>zlecenia</span></div>
              <div className="ref-kpi"><small>Gotowe</small><strong>1</strong><span>odbiór</span></div>
              <div className="ref-kpi"><small>Następne</small><strong>08:00</strong><span>start</span></div>
            </div>

            <RefCard title="Lista zadań">
              <div className="ref-list">
                {jobs.map(([id, client, addr, window, status]) => (
                  <button className="ref-list-row" type="button" key={id}>
                    <span>
                      <strong>{id} · {client}</strong>
                      <small>{addr} · {window}</small>
                    </span>
                    <StatusPill tone={status === 'Pilne' ? 'red' : status === 'W drodze' ? 'orange' : 'olive'}>{status}</StatusPill>
                  </button>
                ))}
              </div>
            </RefCard>

            <RefCard title="Zdjęcia i BHP">
              <div className="ref-grid three" style={{ gap: 10 }}>
                {['Przed', 'W trakcie', 'Po'].map((label, idx) => (
                  <button className="ref-button" type="button" key={label} style={{ minHeight: 78, flexDirection: 'column' }}>
                    <Icon name="camera" />
                    <span>{label}</span>
                    {idx === 0 ? <StatusPill tone="green">OK</StatusPill> : null}
                  </button>
                ))}
              </div>
            </RefCard>
          </main>

          <nav className="ref-bottom-nav" aria-label="Nawigacja mobilna">
            <button className="is-active" type="button"><Icon name="grid" /> Start</button>
            <button type="button"><Icon name="clipboard" /> Zadania</button>
            <button type="button"><Icon name="map" /> GPS</button>
            <button type="button"><Icon name="user" /> Profil</button>
          </nav>
        </div>
      </div>
    </div>
  );
}
