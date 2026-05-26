/**
 * Eksploruj — start operacyjny (odpowiednik mobile: (tabs)/explore.tsx)
 * Siatka kafelków-skrótów do wszystkich modułów systemu, pogrupowana wg roli.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import { readStoredUser } from '../utils/readStoredUser';

// ─── Definicje modułów ────────────────────────────────────────────────────────
const ALL_ROLES = ['Dyrektor', 'Administrator', 'Kierownik', 'Brygadzista', 'Specjalista', 'Pomocnik', 'Pomocnik bez doświadczenia', 'Wyceniający', 'Magazynier'];
const MGMT      = ['Dyrektor', 'Administrator', 'Kierownik'];
const ADMIN     = ['Dyrektor', 'Administrator'];
const SALES     = ['Dyrektor', 'Administrator', 'Kierownik', 'Wyceniający', 'Specjalista'];
const FIELD_OPS = ['Dyrektor', 'Administrator', 'Kierownik', 'Brygadzista', 'Specjalista', 'Pomocnik', 'Pomocnik bez doświadczenia'];
const ASSETS    = ['Dyrektor', 'Administrator', 'Kierownik', 'Brygadzista', 'Magazynier'];

const GROUPS = [
  {
    key: 'operacje',
    label: 'Operacje',
    emoji: '🚜',
    tiles: [
      { path: '/zlecenia',           label: 'Zlecenia',             emoji: '📋', desc: 'Lista i szczegóły zleceń',     roles: [...FIELD_OPS, 'Magazynier'] },
      { path: '/nowe-zlecenie',      label: 'Nowe zlecenie',        emoji: '➕', desc: 'Utwórz nowe zlecenie',         roles: MGMT },
      { path: '/harmonogram',        label: 'Harmonogram',          emoji: '📅', desc: 'Tygodniowy plan ekip',          roles: [...MGMT, 'Brygadzista', 'Specjalista', 'Magazynier'] },
      { path: '/kierownik',          label: 'Planowanie',           emoji: '🎯', desc: 'Dyspozytornia kierownika',      roles: MGMT },
      { path: '/ekipy',              label: 'Ekipy',                emoji: '👷', desc: 'Zarządzanie brygadami',         roles: MGMT },
      { path: '/potwierdzenia-ekip', label: 'Potwierdzenia ekip',   emoji: '✅', desc: 'Dzienna gotowość brygad',       roles: ALL_ROLES },
    ],
  },
  {
    key: 'terenowe',
    label: 'Pole i raporty',
    emoji: '📡',
    tiles: [
      { path: '/misja-dnia',          label: 'Misja dnia',          emoji: '⚡', desc: 'Zadania na dziś',               roles: FIELD_OPS },
      { path: '/autoplan-dnia',       label: 'Autoplan dnia',       emoji: '🤖', desc: 'Automatyczny plan operacyjny',  roles: MGMT },
      { path: '/raporty',             label: 'Raporty',             emoji: '📊', desc: 'Centrum raportów',              roles: FIELD_OPS },
      { path: '/raporty/dzienny',     label: 'Raport dzienny',      emoji: '📝', desc: 'Dzienny raport ekipy',          roles: FIELD_OPS },
      { path: '/raporty/mobilne',     label: 'Raporty mobilne',     emoji: '📱', desc: 'KPI z aplikacji mobilnej',      roles: MGMT },
      { path: '/raporty/kpi-tydzien', label: 'Liga brygad (KPI)',   emoji: '🏆', desc: 'Tygodniowe KPI i rankingi',    roles: FIELD_OPS },
    ],
  },
  {
    key: 'sprzedaz',
    label: 'Sprzedaż i wyceny',
    emoji: '🌿',
    tiles: [
      { path: '/wyceniajacy-hub',    label: 'Centrum specjalisty ds. wyceny',    emoji: '🧑‍💼', desc: 'Centralny panel specjalisty ds. wyceny', roles: SALES },
      { path: '/wycena-kalendarz',   label: 'Kalendarz wycen',      emoji: '🗓️',  desc: 'Planowanie wycen w kalendarzu', roles: SALES },
      { path: '/wyceny-terenowe',    label: 'Wyceny terenowe',      emoji: '🔍', desc: 'Lista wycen M1 u klienta',      roles: SALES },
      { path: '/ogledziny',          label: 'Oględziny',            emoji: '🏡', desc: 'Wizje lokalne nieruchomości',   roles: SALES },
      { path: '/zatwierdz-wyceny',   label: 'Zatwierdź wyceny',     emoji: '✔️', desc: 'Przegląd i zatwierdzanie',     roles: MGMT },
      { path: '/blokady-kalendarza', label: 'Blokady kalendarza',   emoji: '🚫', desc: 'Dni wolne specjalistów ds. wyceny',       roles: SALES },
      { path: '/klienci',            label: 'Klienci',              emoji: '👥', desc: 'Baza klientów',                 roles: MGMT },
      { path: '/crm',                label: 'CRM',                  emoji: '💼', desc: 'Pipeline sprzedażowy',          roles: MGMT },
    ],
  },
  {
    key: 'zasoby',
    label: 'Zasoby i sprzęt',
    emoji: '🔧',
    tiles: [
      { path: '/magazyn',            label: 'Magazyn',              emoji: '🏭', desc: 'Stan magazynowy sprzętu',       roles: ASSETS },
      { path: '/rezerwacje-sprzetu', label: 'Rezerwacje sprzętu',   emoji: '📆', desc: 'Kalendarz rezerwacji',          roles: ASSETS },
      { path: '/flota',              label: 'Flota',                emoji: '🚛', desc: 'Pojazdy i przyczepy',           roles: ASSETS },
    ],
  },
  {
    key: 'finanse',
    label: 'Finanse',
    emoji: '💰',
    tiles: [
      { path: '/rozliczenia-ekip',            label: 'Rozliczenia ekip',       emoji: '💵', desc: 'Eksport kadrowy M11',            roles: MGMT },
      { path: '/rozliczenia-polowe',          label: 'Rozliczenia polowe',     emoji: '⏱', desc: 'Godziny pomocników, kalkulator',  roles: ['Dyrektor', 'Administrator', 'Kierownik', 'Brygadzista'] },
      { path: '/wynagrodzenie-wyceniajacych', label: 'Prowizje specjalistów ds. wyceny', emoji: '💹', desc: 'Kalkulacja wynagrodzeń',         roles: ['Dyrektor', 'Administrator', 'Kierownik', 'Wyceniający'] },
      { path: '/ksiegowosc',                 label: 'Księgowość',             emoji: '🧾', desc: 'Faktury i dokumenty finansowe',   roles: MGMT },
    ],
  },
  {
    key: 'kadry',
    label: 'Kadry i konfiguracja',
    emoji: '⚙️',
    tiles: [
      { path: '/uzytkownicy',      label: 'Użytkownicy',       emoji: '🧑‍🤝‍🧑', desc: 'Pracownicy i uprawnienia',    roles: ADMIN },
      { path: '/oddzialy',         label: 'Oddziały',          emoji: '🏢',   desc: 'Struktura oddziałów',          roles: ADMIN },
      { path: '/kadry-dokumenty',  label: 'Kadry / Dokumenty', emoji: '📁',   desc: 'Karty stanowisk i umowy',      roles: MGMT },
      { path: '/zarzadzaj-rolami', label: 'Role',              emoji: '🔑',   desc: 'Zarządzanie rolami systemu',   roles: ADMIN },
      { path: '/integracje',       label: 'Integracje',        emoji: '🔗',   desc: 'Webhooki i API zewnętrzne',    roles: MGMT },
      { path: '/profil',           label: 'Mój profil',        emoji: '👤',   desc: 'Dane, motyw, wylogowanie',     roles: ALL_ROLES },
      { path: '/zadania',          label: 'Moje zadania',      emoji: '📌',   desc: 'Lista zadań własnych',         roles: ALL_ROLES },
    ],
  },
];

// ─── Komponent ────────────────────────────────────────────────────────────────
export default function Eksploruj() {
  const navigate   = useNavigate();
  const [user, setUser] = useState(null);
  const [search, setSearch] = useState('');
  const [hoveredPath, setHoveredPath] = useState(null);

  useEffect(() => {
    setUser(readStoredUser());
  }, []);

  const role = user?.rola || '';

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return GROUPS.map((g) => {
      const tiles = g.tiles.filter((t) => {
        if (!t.roles.includes(role) && role) return false;
        if (!q) return true;
        return (
          t.label.toLowerCase().includes(q) ||
          t.desc.toLowerCase().includes(q) ||
          g.label.toLowerCase().includes(q)
        );
      });
      return { ...g, tiles };
    }).filter((g) => g.tiles.length > 0);
  }, [role, search]);

  const totalTiles = useMemo(
    () => filteredGroups.reduce((s, g) => s + g.tiles.length, 0),
    [filteredGroups],
  );

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      <Sidebar />
      <main style={{ flex: 1, padding: '28px 28px 48px', minWidth: 0 }}>
        {/* Nagłówek */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, color: 'var(--text)' }}>
            Eksploruj system
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--text-muted)' }}>
            Skróty do wszystkich modułów — wybierz, co dziś potrzebujesz.
          </p>
        </div>

        {/* Szukajka */}
        <div style={{ marginBottom: 24, maxWidth: 420 }}>
          <div style={{ position: 'relative' }}>
            <svg
              width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round"
              style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
            >
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="search"
              placeholder="Szukaj modułu…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px 10px 38px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--surface-field)',
                color: 'var(--text)',
                fontSize: 14,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          {search && (
            <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
              Znaleziono {totalTiles} moduł{totalTiles === 1 ? '' : totalTiles < 5 ? 'y' : 'ów'}
            </p>
          )}
        </div>

        {/* Grupy z kafelkami */}
        {filteredGroups.map((group) => (
          <section key={group.key} style={{ marginBottom: 32 }}>
            <h2 style={{
              margin: '0 0 12px',
              fontSize: 13,
              fontWeight: 800,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <span>{group.emoji}</span>
              <span>{group.label}</span>
            </h2>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 10,
            }}>
              {group.tiles.map((tile) => {
                const isHov = hoveredPath === tile.path;
                return (
                  <button
                    key={tile.path}
                    type="button"
                    onClick={() => navigate(tile.path)}
                    onMouseEnter={() => setHoveredPath(tile.path)}
                    onMouseLeave={() => setHoveredPath(null)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: 6,
                      padding: '14px 16px',
                      borderRadius: 8,
                      border: `1px solid ${isHov ? 'var(--accent)' : 'var(--glass-border)'}`,
                      background: isHov
                        ? 'linear-gradient(135deg, var(--accent-surface), var(--surface-glass))'
                        : 'var(--surface-glass)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s',
                      boxShadow: isHov ? 'var(--shadow-md)' : 'var(--shadow-sm)',
                    }}
                  >
                    <span style={{
                      fontSize: 26,
                      lineHeight: 1,
                      filter: isHov ? 'drop-shadow(0 2px 6px rgba(0,0,0,0.4))' : 'none',
                      transition: 'filter 0.15s',
                    }}>
                      {tile.emoji}
                    </span>
                    <div>
                      <div style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: isHov ? 'var(--accent)' : 'var(--text)',
                        lineHeight: 1.2,
                        transition: 'color 0.15s',
                      }}>
                        {tile.label}
                      </div>
                      <div style={{
                        fontSize: 12,
                        color: 'var(--text-muted)',
                        marginTop: 3,
                        lineHeight: 1.35,
                      }}>
                        {tile.desc}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        {filteredGroups.length === 0 && (
          <div style={{ textAlign: 'center', padding: '64px 0', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
            <p style={{ fontSize: 15, margin: 0 }}>Brak modułów pasujących do „{search}"</p>
            <p style={{ fontSize: 13, margin: '6px 0 0' }}>Spróbuj innej frazy</p>
          </div>
        )}
      </main>
    </div>
  );
}
