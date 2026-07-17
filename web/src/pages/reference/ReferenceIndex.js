import { Link } from 'react-router-dom';
import { ArborLogo, Icon } from './ArborReferenceComponents';

const views = [
  {
    title: 'Arbor OS',
    path: '/reference/arbor-os',
    icon: 'grid',
    desc: 'Desktopowa konsola operacyjna z bocznym paskiem, KPI, mapą i listą zleceń.',
  },
  {
    title: 'Arbor OS Deck',
    path: '/reference/arbor-os-deck',
    icon: 'chart',
    desc: 'Prezentacyjny ekran systemu w ciemnym stylu Polska Flora.',
  },
  {
    title: 'Portal Klienta',
    path: '/reference/portal-klienta',
    icon: 'file',
    desc: 'Status zlecenia, timeline, ekipa, zakres prac i dokumenty klienta.',
  },
  {
    title: 'Gabinet Wyceniającego',
    path: '/reference/gabinet-wyceniajacego',
    icon: 'clipboard',
    desc: 'Kolejka zapytań, kosztorys, podsumowanie VAT i wysyłka oferty.',
  },
  {
    title: 'Arbor Mobile',
    path: '/reference/arbor-mobile',
    icon: 'phone',
    desc: 'Mobilny podgląd misji dnia, zadań, zdjęć i dolnej nawigacji.',
  },
];

export default function ReferenceIndex() {
  return (
    <div className="ref-page">
      <main className="ref-main" style={{ width: 'min(1180px, calc(100vw - 32px))' }}>
        <header className="ref-topbar">
          <ArborLogo sub="Reference UI" />
          <div className="ref-title-block">
            <small>Przepisane osobno</small>
            <h1>Widoki referencyjne Arbor</h1>
            <p>Każdy eksport HTML ma osobny widok React, osobny adres i wspólne komponenty brandu.</p>
          </div>
        </header>

        <section className="ref-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {views.map((view) => (
            <Link className="ref-card" key={view.path} to={view.path} style={{ minHeight: 190, display: 'flex', flexDirection: 'column', gap: 12, textDecoration: 'none' }}>
              <span className="ref-logo-mark" style={{ boxShadow: 'none' }}><Icon name={view.icon} /></span>
              <h2 style={{ margin: 0 }}>{view.title}</h2>
              <p style={{ margin: 0, color: '#8a8069', lineHeight: 1.45 }}>{view.desc}</p>
              <span style={{ marginTop: 'auto', color: '#5d6a0b', fontWeight: 900 }}>Otwórz widok</span>
            </Link>
          ))}
        </section>
      </main>
    </div>
  );
}
