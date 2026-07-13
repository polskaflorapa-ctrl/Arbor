import { ArborLogo, Icon, ProgressBar, RefCard, StatusPill } from './ArborReferenceComponents';

const steps = [
  ['Zlecenie przyjęte', '12.06 · 08:12', 'done'],
  ['Wycena zaakceptowana', '12.06 · 14:40', 'done'],
  ['Ekipa przydzielona · A1', '13.06 · 09:40', 'done'],
  ['Prace w toku', 'dziś · 10:05', 'current'],
  ['Odbiór i rozliczenie', 'planowane 14.06', 'next'],
];

const docs = [
  ['Oferta.pdf', 'PDF · 240 kB', 'olive'],
  ['Umowa.pdf', 'PDF · 180 kB', 'green'],
  ['Zdjęcia przed', '4 pliki', 'orange'],
];

export default function ClientPortalReference() {
  return (
    <div className="ref-page" style={{ padding: '0 20px 60px' }}>
      <header style={{ width: 'min(860px, 100%)', margin: '0 auto', padding: '22px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <ArborLogo sub="Portal klienta" />
        <a className="ref-button" href="tel:+48221002030"><Icon name="phone" /> Biuro obsługi</a>
      </header>

      <main style={{ width: 'min(860px, 100%)', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <section className="ref-hero-dark" style={{ padding: '26px 28px' }}>
          <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <small>Zlecenie #1042</small>
              <h1 style={{ margin: '8px 0 0', fontSize: 28, lineHeight: 1.1 }}>Pielęgnacja i wycinka - al. Klonowa 5</h1>
              <p style={{ marginTop: 6 }}>al. Klonowa 5, Warszawa</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <StatusPill tone="orange">W realizacji</StatusPill>
              <p style={{ margin: '10px 0 0' }}>Planowany termin</p>
              <strong style={{ fontSize: 17 }}>14 czerwca</strong>
            </div>
          </div>
          <div style={{ marginTop: 22 }}><ProgressBar value={68} /></div>
          <p style={{ margin: '8px 0 0', fontSize: 12.5 }}>Etap 4 z 5 · ekipa na miejscu</p>
        </section>

        <div className="ref-grid two">
          <RefCard title="Status realizacji">
            <div className="ref-timeline">
              {steps.map(([label, time, state]) => (
                <div className={`ref-step is-${state}`} key={label}>
                  <span className="ref-step-dot">{state === 'done' ? <Icon name="check" /> : null}</span>
                  <div>
                    <strong>{label}</strong>
                    <small>{time}</small>
                  </div>
                </div>
              ))}
            </div>
          </RefCard>

          <div className="ref-grid">
            <RefCard title="Twoja ekipa">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', borderRadius: 13, background: '#f1f3d6', color: '#5d6a0b', fontWeight: 900 }}>JK</span>
                <div><strong>Jan Kowalski</strong><small style={{ display: 'block', color: '#8a8069' }}>Brygadzista · 4-osobowa ekipa</small></div>
              </div>
              <a className="ref-button is-primary" style={{ width: '100%', marginTop: 14 }} href="tel:+48500100100"><Icon name="phone" /> Zadzwoń do brygadzisty</a>
            </RefCard>

            <RefCard title="Zakres prac">
              <div className="ref-list">
                {['Wycinka 3 topoli (zagrożenie)', 'Pielęgnacja koron - 5 drzew', 'Frezowanie pni', 'Uprzątnięcie i wywóz'].map((label, idx) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 9, color: '#3b3120', fontSize: 13.5 }}>
                    <span style={{ width: 18, height: 18, display: 'grid', placeItems: 'center', borderRadius: 6, background: idx < 2 ? '#7f8c12' : '#ece7da', color: '#fff' }}>{idx < 2 ? <Icon name="check" /> : null}</span>
                    {label}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, paddingTop: 14, borderTop: '1px solid #f0ebdd' }}>
                <span style={{ color: '#8a8069', fontSize: 13 }}>Wartość zlecenia</span>
                <strong>6 800 zł</strong>
              </div>
            </RefCard>
          </div>
        </div>

        <RefCard title="Dokumenty">
          <div className="ref-grid three">
            {docs.map(([name, meta, tone]) => (
              <button className="ref-button" key={name} type="button" style={{ justifyContent: 'flex-start', height: 'auto', padding: 14 }}>
                <StatusPill tone={tone}><Icon name="file" /></StatusPill>
                <span style={{ textAlign: 'left' }}><strong style={{ display: 'block' }}>{name}</strong><small style={{ color: '#8a8069' }}>{meta}</small></span>
              </button>
            ))}
          </div>
        </RefCard>

        <p style={{ textAlign: 'center', color: '#a89f8c', fontSize: 12, margin: '6px 0 0' }}>Polska Flora · pielęgnacja i wycinka drzew · portal aktualizowany na żywo</p>
      </main>
    </div>
  );
}
