import { ArborLogo, Icon, Money, StatusPill } from './ArborReferenceComponents';

const queue = [
  ['Hotel Park', 'Pielęgnacja koron', 'Telefon', '10:40', 'Pilne'],
  ['Spółdzielnia Bryza', 'Wycinka awaryjna', 'WWW', '09:15', 'Wysoki'],
  ['Wspólnota Brzozowa', 'Frezowanie pni', 'E-mail', 'wczoraj', 'Normalny'],
];

const items = [
  ['Wycinka drzewa 20-40 cm', '3', '900 zł', '2 700 zł'],
  ['Podnośnik koszowy', '1', '1 200 zł', '1 200 zł'],
  ['Wywóz i utylizacja', '1', '850 zł', '850 zł'],
];

export default function EstimatorOfficeReference() {
  return (
    <div className="ref-page ref-estimator-page">
      <main className="ref-main">
        <header className="ref-topbar">
          <ArborLogo sub="Gabinet wyceniającego" />
          <div className="ref-title-block">
            <small>Gabinet wyceniającego</small>
            <h1>Oferta gotowa w kilka minut</h1>
            <p>Osobny widok zgodny z eksportem: ciemne biuro, aktywna kolejka, kosztorys i wysyłka oferty bez zbędnych ekranów.</p>
          </div>
          <button className="ref-button is-primary" type="button"><Icon name="send" /> Wyślij wycenę</button>
        </header>

        <section className="ref-estimator-layout">
          <aside className="ref-estimator-panel">
            <h2>Kolejka zapytań</h2>
            <div className="ref-estimator-queue">
              {queue.map(([client, service, channel, time, priority], idx) => (
                <button key={client} type="button" className="ref-list-row" style={{ background: idx === 0 ? 'rgba(160,175,20,0.16)' : 'rgba(255,255,255,0.05)', borderColor: idx === 0 ? '#a0af14' : 'rgba(255,255,255,0.09)', color: '#efe9da' }}>
                  <span style={{ minWidth: 0 }}>
                    <strong style={{ color: '#fff' }}>{client}</strong>
                    <small>{service} · {channel} · {time}</small>
                  </span>
                  <StatusPill tone={idx === 0 ? 'orange' : 'olive'}>{priority}</StatusPill>
                </button>
              ))}
            </div>
          </aside>

          <section className="ref-estimator-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, marginBottom: 16 }}>
              <div>
                <small style={{ color: '#a0af14', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 900 }}>WY-0193</small>
                <h2 style={{ margin: '6px 0 0' }}>Hotel Park · pielęgnacja koron</h2>
                <p style={{ margin: '6px 0 0' }}>ul. Ogrodowa 12, Warszawa · +48 500 100 100</p>
              </div>
              <StatusPill tone="olive">Nowa wycena</StatusPill>
            </div>

            <div className="ref-estimator-quote-row" style={{ color: '#a0af14', fontWeight: 900, fontSize: 12, textTransform: 'uppercase' }}>
              <span>Pozycja</span><span>Ilość</span><span>Cena</span><span>Wartość</span><span />
            </div>
            {items.map(([name, qty, price, line]) => (
              <div className="ref-estimator-quote-row" key={name}>
                <input className="ref-estimator-input" defaultValue={name} aria-label={`Nazwa pozycji ${name}`} />
                <input className="ref-estimator-input" defaultValue={qty} aria-label={`Ilość ${name}`} />
                <input className="ref-estimator-input" defaultValue={price} aria-label={`Cena ${name}`} />
                <Money>{line}</Money>
                <button className="ref-button" type="button" aria-label={`Usuń ${name}`}>×</button>
              </div>
            ))}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
              {['Dodaj pozycję', 'Rabat 10%', 'Drzewo awaryjne', 'Podnośnik'].map((label) => (
                <button className="ref-button" type="button" key={label}>{label}</button>
              ))}
            </div>
          </section>

          <aside className="ref-estimator-panel">
            <h2>Podsumowanie</h2>
            <div className="ref-list">
              {[
                ['Netto', '4 750 zł'],
                ['Rabat', '-0 zł'],
                ['VAT 23%', '1 093 zł'],
                ['Brutto', '5 843 zł'],
              ].map(([label, value], idx) => (
                <div className="ref-list-row" key={label} style={{ background: idx === 3 ? 'rgba(160,175,20,0.16)' : 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.09)' }}>
                  <span>{label}</span>
                  <Money>{value}</Money>
                </div>
              ))}
            </div>
            <textarea className="ref-estimator-input" style={{ minHeight: 120, marginTop: 14, padding: 12 }} defaultValue="Oferta obejmuje zabezpieczenie terenu, pielęgnację koron oraz pełny wywóz gałęzi." aria-label="Notatka do oferty" />
            <button className="ref-button is-primary" type="button" style={{ width: '100%', marginTop: 14 }}><Icon name="send" /> Wyślij do klienta</button>
          </aside>
        </section>

        <section className="ref-estimator-panel" style={{ marginTop: 18 }}>
          <h2>Ostatnio wysłane</h2>
          <div className="ref-grid three">
            {[
              ['Hotel Park', 'WY-0192', '4 200 zł', 'Zaakceptowana', 'green'],
              ['Spółdzielnia Bryza', 'WY-0191', '9 400 zł', 'Wysłana', 'olive'],
              ['Zarząd Zieleni', 'WY-0190', '2 900 zł', 'Negocjacje', 'orange'],
            ].map(([client, id, value, status, tone]) => (
              <div className="ref-list-row" key={id} style={{ background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.09)' }}>
                <span><strong style={{ color: '#fff' }}>{client}</strong><small>{id}</small></span>
                <Money>{value}</Money>
                <StatusPill tone={tone}>{status}</StatusPill>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
