import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AddCircleOutlineOutlined from '@mui/icons-material/AddCircleOutlineOutlined';
import AssessmentOutlined from '@mui/icons-material/AssessmentOutlined';
import AssignmentOutlined from '@mui/icons-material/AssignmentOutlined';
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import BlockOutlined from '@mui/icons-material/BlockOutlined';
import BusinessOutlined from '@mui/icons-material/BusinessOutlined';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import CheckCircleOutlineOutlined from '@mui/icons-material/CheckCircleOutlineOutlined';
import ChecklistOutlined from '@mui/icons-material/ChecklistOutlined';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import DirectionsCarOutlined from '@mui/icons-material/DirectionsCarOutlined';
import EmojiEventsOutlined from '@mui/icons-material/EmojiEventsOutlined';
import GroupsOutlined from '@mui/icons-material/GroupsOutlined';
import HandymanOutlined from '@mui/icons-material/HandymanOutlined';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import KeyOutlined from '@mui/icons-material/KeyOutlined';
import LinkOutlined from '@mui/icons-material/LinkOutlined';
import LocalPhoneOutlined from '@mui/icons-material/LocalPhoneOutlined';
import ManageAccountsOutlined from '@mui/icons-material/ManageAccountsOutlined';
import MapOutlined from '@mui/icons-material/MapOutlined';
import PaidOutlined from '@mui/icons-material/PaidOutlined';
import PaymentsOutlined from '@mui/icons-material/PaymentsOutlined';
import PersonOutlineOutlined from '@mui/icons-material/PersonOutlineOutlined';
import PhoneIphoneOutlined from '@mui/icons-material/PhoneIphoneOutlined';
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined';
import RouteOutlined from '@mui/icons-material/RouteOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import Sidebar from '../components/Sidebar';
import { readStoredUser } from '../utils/readStoredUser';
import { hasAnyRole } from '../utils/roleDisplay';

const ALL_ROLES = ['Dyrektor', 'Administrator', 'Kierownik', 'Brygadzista', 'Specjalista', 'Pomocnik', 'Pomocnik bez doświadczenia', 'Wyceniający', 'Wyceniajacy', 'Magazynier'];
const MGMT = ['Dyrektor', 'Administrator', 'Kierownik'];
const ADMIN = ['Dyrektor', 'Administrator'];
const SALES = ['Dyrektor', 'Administrator', 'Kierownik', 'Wyceniający', 'Wyceniajacy', 'Specjalista'];
const FIELD_OPS = ['Dyrektor', 'Administrator', 'Kierownik', 'Brygadzista', 'Specjalista', 'Pomocnik', 'Pomocnik bez doświadczenia'];
const ASSETS = ['Dyrektor', 'Administrator', 'Kierownik', 'Brygadzista', 'Magazynier'];

const GROUPS = [
  {
    key: 'operacje',
    label: 'Operacje',
    note: 'Zlecenia, ekipy i codzienna dyspozytornia.',
    color: '#10b981',
    Icon: RouteOutlined,
    tiles: [
      { path: '/zlecenia', label: 'Zlecenia', Icon: AssignmentOutlined, desc: 'Lista, statusy i szczegóły zleceń', roles: [...FIELD_OPS, 'Magazynier'] },
      { path: '/nowe-zlecenie', label: 'Nowe zlecenie', Icon: AddCircleOutlineOutlined, desc: 'Szybkie przyjęcie nowej pracy', roles: MGMT },
      { path: '/harmonogram', label: 'Harmonogram', Icon: CalendarMonthOutlined, desc: 'Tygodniowy plan ekip i terminów', roles: [...MGMT, 'Brygadzista', 'Specjalista', 'Magazynier'] },
      { path: '/kierownik', label: 'Planowanie', Icon: MapOutlined, desc: 'Dyspozytornia kierownika', roles: MGMT },
      { path: '/ekipy', label: 'Ekipy', Icon: GroupsOutlined, desc: 'Składy, brygady i gotowość', roles: MGMT },
      { path: '/potwierdzenia-ekip', label: 'Potwierdzenia ekip', Icon: CheckCircleOutlineOutlined, desc: 'Dzienna kontrola gotowości', roles: ALL_ROLES },
    ],
  },
  {
    key: 'terenowe',
    label: 'Pole i raporty',
    note: 'Praca terenowa, raporty i kontrola wykonania.',
    color: '#0ea5e9',
    Icon: PhoneIphoneOutlined,
    tiles: [
      { path: '/misja-dnia', label: 'Misja dnia', Icon: ChecklistOutlined, desc: 'Zadania i priorytety na dziś', roles: FIELD_OPS },
      { path: '/autoplan-dnia', label: 'Autoplan dnia', Icon: AutoAwesomeOutlined, desc: 'Automatyczny plan operacyjny', roles: MGMT },
      { path: '/raporty', label: 'Raporty', Icon: AssessmentOutlined, desc: 'Centrum raportów operacyjnych', roles: FIELD_OPS },
      { path: '/raporty/dzienny', label: 'Raport dzienny', Icon: DescriptionOutlined, desc: 'Dzienny raport ekipy', roles: FIELD_OPS },
      { path: '/raporty/mobilne', label: 'Raporty mobilne', Icon: PhoneIphoneOutlined, desc: 'KPI z aplikacji mobilnej', roles: MGMT },
      { path: '/raporty/kpi-tydzien', label: 'Liga brygad', Icon: EmojiEventsOutlined, desc: 'Tygodniowe KPI i rankingi', roles: FIELD_OPS },
    ],
  },
  {
    key: 'sprzedaz',
    label: 'Sprzedaż i wyceny',
    note: 'Leady, oględziny, CRM i akceptacje wycen.',
    color: '#8b5cf6',
    Icon: LocalPhoneOutlined,
    tiles: [
      { path: '/wyceniajacy-hub', label: 'Centrum wycen', Icon: ManageAccountsOutlined, desc: 'Panel specjalisty ds. wyceny', roles: SALES },
      { path: '/wycena-kalendarz', label: 'Kalendarz wycen', Icon: CalendarMonthOutlined, desc: 'Planowanie wizyt u klientów', roles: SALES },
      { path: '/wyceny-terenowe', label: 'Wyceny terenowe', Icon: SearchOutlined, desc: 'Lista wycen M1 u klienta', roles: SALES },
      { path: '/ogledziny', label: 'Oględziny', Icon: MapOutlined, desc: 'Wizje lokalne nieruchomości', roles: SALES },
      { path: '/zatwierdz-wyceny', label: 'Zatwierdź wyceny', Icon: CheckCircleOutlineOutlined, desc: 'Przegląd i akceptacja', roles: MGMT },
      { path: '/blokady-kalendarza', label: 'Blokady kalendarza', Icon: BlockOutlined, desc: 'Dni wolne i niedostępności', roles: SALES },
      { path: '/klienci', label: 'Klienci', Icon: GroupsOutlined, desc: 'Baza klientów i kontaktów', roles: MGMT },
      { path: '/crm', label: 'CRM', Icon: LocalPhoneOutlined, desc: 'Pipeline sprzedażowy', roles: MGMT },
    ],
  },
  {
    key: 'zasoby',
    label: 'Zasoby i sprzęt',
    note: 'Magazyn, flota i rezerwacje narzędzi.',
    color: '#f59e0b',
    Icon: HandymanOutlined,
    tiles: [
      { path: '/magazyn', label: 'Magazyn', Icon: Inventory2Outlined, desc: 'Stan sprzętu i materiałów', roles: ASSETS },
      { path: '/rezerwacje-sprzetu', label: 'Rezerwacje sprzętu', Icon: CalendarMonthOutlined, desc: 'Kalendarz rezerwacji', roles: ASSETS },
      { path: '/flota', label: 'Flota', Icon: DirectionsCarOutlined, desc: 'Pojazdy, przyczepy i serwis', roles: ASSETS },
    ],
  },
  {
    key: 'finanse',
    label: 'Finanse',
    note: 'Rozliczenia, prowizje i dokumenty księgowe.',
    color: '#14b8a6',
    Icon: PaidOutlined,
    tiles: [
      { path: '/rozliczenia-ekip', label: 'Rozliczenia ekip', Icon: PaymentsOutlined, desc: 'Eksport kadrowy M11', roles: MGMT },
      { path: '/rozliczenia-polowe', label: 'Rozliczenia polowe', Icon: ReceiptLongOutlined, desc: 'Godziny i kalkulator pracy', roles: ['Dyrektor', 'Administrator', 'Kierownik', 'Brygadzista'] },
      { path: '/wynagrodzenie-wyceniajacych', label: 'Prowizje wycen', Icon: PaidOutlined, desc: 'Kalkulacja wynagrodzeń', roles: ['Dyrektor', 'Administrator', 'Kierownik', 'Wyceniający', 'Wyceniajacy'] },
      { path: '/ksiegowosc', label: 'Księgowość', Icon: DescriptionOutlined, desc: 'Faktury i dokumenty finansowe', roles: MGMT },
    ],
  },
  {
    key: 'kadry',
    label: 'Kadry i konfiguracja',
    note: 'Ludzie, oddziały, role i integracje.',
    color: '#64748b',
    Icon: SettingsOutlined,
    tiles: [
      { path: '/uzytkownicy', label: 'Użytkownicy', Icon: ManageAccountsOutlined, desc: 'Pracownicy i uprawnienia', roles: ADMIN },
      { path: '/oddzialy', label: 'Oddziały', Icon: BusinessOutlined, desc: 'Struktura oddziałów', roles: ADMIN },
      { path: '/kadry-dokumenty', label: 'Kadry / Dokumenty', Icon: DescriptionOutlined, desc: 'Karty stanowisk i umowy', roles: MGMT },
      { path: '/zarzadzaj-rolami', label: 'Role', Icon: KeyOutlined, desc: 'Zarządzanie rolami systemu', roles: ADMIN },
      { path: '/integracje', label: 'Integracje', Icon: LinkOutlined, desc: 'Webhooki i API zewnętrzne', roles: MGMT },
      { path: '/profil', label: 'Mój profil', Icon: PersonOutlineOutlined, desc: 'Dane, motyw i ustawienia', roles: ALL_ROLES },
      { path: '/zadania', label: 'Moje zadania', Icon: ChecklistOutlined, desc: 'Lista zadań własnych', roles: ALL_ROLES },
    ],
  },
];

const PRIORITY_PATHS = ['/nowe-zlecenie', '/harmonogram', '/kierownik', '/zlecenia'];

export default function Eksploruj() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setUser(readStoredUser());
  }, []);

  const role = user?.rola || '';
  const firstName = user?.imie || user?.login || 'zespole';

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return GROUPS.map((group) => {
      const tiles = group.tiles.filter((tile) => {
        if (!hasAnyRole(role, tile.roles) && role) return false;
        if (!q) return true;
        return (
          tile.label.toLowerCase().includes(q) ||
          tile.desc.toLowerCase().includes(q) ||
          group.label.toLowerCase().includes(q)
        );
      });
      return { ...group, tiles };
    }).filter((group) => group.tiles.length > 0);
  }, [role, search]);

  const allVisibleTiles = useMemo(
    () => filteredGroups.flatMap((group) => group.tiles.map((tile) => ({ ...tile, group: group.label, color: group.color }))),
    [filteredGroups],
  );

  const priorityTiles = useMemo(() => {
    const byPath = new Map(allVisibleTiles.map((tile) => [tile.path, tile]));
    const priority = PRIORITY_PATHS.map((path) => byPath.get(path)).filter(Boolean);
    return priority.length ? priority.slice(0, 4) : allVisibleTiles.slice(0, 4);
  }, [allVisibleTiles]);

  const totalTiles = allVisibleTiles.length;

  return (
    <div className="explore-shell explore-command-shell">
      <Sidebar />
      <main className="explore-main explore-command-main">
        <section className="explore-hero" aria-labelledby="explore-title">
          <div className="explore-hero-copy">
            <span className="explore-eyebrow">Polska Flora Command Center</span>
            <h1 id="explore-title">Dzień dobry, {firstName}</h1>
            <p>
              Wybierz moduł według pracy, którą chcesz teraz wykonać. Najważniejsze akcje są na górze,
              a pełna mapa systemu jest pogrupowana niżej.
            </p>
            <div className="explore-search-wrap">
              <SearchOutlined aria-hidden="true" />
              <input
                type="search"
                placeholder="Szukaj: zlecenia, flota, rozliczenia..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Szukaj modułu"
              />
            </div>
          </div>

          <div className="explore-status-panel" aria-label="Status widoku">
            <div>
              <span>Dostępne moduły</span>
              <strong>{totalTiles}</strong>
            </div>
            <div>
              <span>Rola</span>
              <strong>{role || 'Demo'}</strong>
            </div>
            <div>
              <span>Sekcje</span>
              <strong>{filteredGroups.length}</strong>
            </div>
          </div>
        </section>

        {priorityTiles.length > 0 && (
          <section className="explore-priority" aria-label="Najważniejsze akcje">
            <div className="explore-section-heading">
              <span>Start dnia</span>
              <strong>Najkrótsza droga do pracy operacyjnej</strong>
            </div>
            <div className="explore-priority-grid">
              {priorityTiles.map((tile) => (
                <button key={tile.path} type="button" className="explore-priority-tile" onClick={() => navigate(tile.path)}>
                  <span className="explore-priority-icon" style={{ '--tile-color': tile.color }}>
                    <tile.Icon fontSize="small" />
                  </span>
                  <span>
                    <strong>{tile.label}</strong>
                    <small>{tile.desc}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="explore-groups">
          {filteredGroups.map((group) => (
            <section key={group.key} className="explore-group-panel" style={{ '--group-color': group.color }}>
              <header className="explore-group-header">
                <span className="explore-group-icon"><group.Icon fontSize="small" /></span>
                <div>
                  <h2>{group.label}</h2>
                  <p>{group.note}</p>
                </div>
                <strong>{group.tiles.length}</strong>
              </header>

              <div className="explore-grid">
                {group.tiles.map((tile) => (
                  <button key={tile.path} type="button" className="explore-tile explore-command-tile" onClick={() => navigate(tile.path)}>
                    <span className="explore-tile-icon"><tile.Icon fontSize="small" /></span>
                    <span className="explore-tile-body">
                      <strong>{tile.label}</strong>
                      <small>{tile.desc}</small>
                    </span>
                    <span className="explore-tile-arrow" aria-hidden="true">→</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>

        {filteredGroups.length === 0 && (
          <section className="explore-empty">
            <SearchOutlined />
            <h2>Brak modułów dla „{search}”</h2>
            <p>Spróbuj wpisać krótszą frazę albo nazwę obszaru, np. „zlecenia”, „flota”, „raporty”.</p>
            <button type="button" onClick={() => setSearch('')}>Wyczyść wyszukiwanie</button>
          </section>
        )}
      </main>
    </div>
  );
}
