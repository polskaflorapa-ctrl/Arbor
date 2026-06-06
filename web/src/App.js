import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ThemeProvider } from './ThemeContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import LandingPage from './pages/LandingPage';
import AiChat from './components/AiChat';

const DevPanel = import.meta.env.DEV
  ? lazy(() => import('./components/DevPanel').then((module) => ({ default: module.DevPanel })))
  : null;

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Zlecenia = lazy(() => import('./pages/Zlecenia'));
const NoweZlecenie = lazy(() => import('./pages/NoweZlecenie'));
const Kierownik = lazy(() => import('./pages/Kierownik'));
const KontrolaOperacyjna = lazy(() => import('./pages/KontrolaOperacyjna'));
const Ekipy = lazy(() => import('./pages/Ekipy'));
const RaportyCentrum = lazy(() => import('./pages/RaportyCentrum'));
const Raporty = lazy(() => import('./pages/Raporty'));
const RaportDzienny = lazy(() => import('./pages/RaportDzienny'));
const RaportyMobilne = lazy(() => import('./pages/RaportyMobilne'));
const KpiTydzien = lazy(() => import('./pages/KpiTydzien'));
const MisjaDnia = lazy(() => import('./pages/MisjaDnia'));
const AutoplanDnia = lazy(() => import('./pages/AutoplanDnia'));
const Uzytkownicy = lazy(() => import('./pages/Uzytkownicy'));
const UzytkownikDetail = lazy(() => import('./pages/UzytkownikDetail'));
const NowyPracownik = lazy(() => import('./pages/NowyPracownik'));
const Oddzialy = lazy(() => import('./pages/Oddzialy'));
const OddzialDetail = lazy(() => import('./pages/OddzialDetail'));
const Flota = lazy(() => import('./pages/Flota'));
const MagazynWeb = lazy(() => import('./pages/MagazynWeb'));
const RezerwacjeSprzetu = lazy(() => import('./pages/RezerwacjeSprzetu'));
const PotwierdzeniaEkip = lazy(() => import('./pages/PotwierdzeniaEkip'));
const RankingBrygad = lazy(() => import('./pages/RankingBrygad'));
const Crm = lazy(() => import('./pages/Crm'));
const CrmDashboard = lazy(() => import('./pages/CrmDashboard'));
const CrmInbox = lazy(() => import('./pages/CrmInbox'));
const CrmPipeline = lazy(() => import('./pages/CrmPipeline'));
const Powiadomienia = lazy(() => import('./pages/Powiadomienia'));
const Telefonia = lazy(() => import('./pages/Telefonia'));
const Harmonogram = lazy(() => import('./pages/Harmonogram'));
const Ksiegowosc = lazy(() => import('./pages/Ksiegowosc'));
const WycenaKalendarz = lazy(() => import('./pages/WycenaKalendarz'));
const BlokadyKalendarza = lazy(() => import('./pages/BlokadyKalendarza'));
const WycenaRysuj = lazy(() => import('./pages/WycenaRysuj'));
const ZatwierdzWyceny = lazy(() => import('./pages/ZatwierdzWyceny'));
const WycenyTerenowe = lazy(() => import('./pages/WycenyTerenowe'));
const WycenaTerenowaDetail = lazy(() => import('./pages/WycenaTerenowaDetail'));
const ZarzadzajRolami = lazy(() => import('./pages/ZarzadzajRolami'));
const Klienci = lazy(() => import('./pages/Klienci'));
const Ogledziny = lazy(() => import('./pages/Ogledziny'));
const OgledzinyDokumentacja = lazy(() => import('./pages/OgledzinyDokumentacja'));
const WyceniajacyHub = lazy(() => import('./pages/WyceniajacyHub'));
const Profil = lazy(() => import('./pages/Profil'));
const ZadaniaOperatora = lazy(() => import('./pages/ZadaniaOperatora'));
const KadryDokumenty = lazy(() => import('./pages/KadryDokumenty'));
const KartaStanowiskaDruk = lazy(() => import('./pages/KartaStanowiskaDruk'));
const WynagrodzenieWyceniajacych = lazy(() => import('./pages/WynagrodzenieWyceniajacych'));
const PayrollM11 = lazy(() => import('./pages/PayrollM11'));
const Integracje = lazy(() => import('./pages/Integracje'));
const DemoRequests = lazy(() => import('./pages/DemoRequests'));
const Eksploruj = lazy(() => import('./pages/Eksploruj'));
const RozliczeniaFieldEntry = lazy(() => import('./pages/RozliczeniaFieldEntry'));
const AutoDispatch = lazy(() => import('./pages/AutoDispatch'));
const BiDashboard = lazy(() => import('./pages/BiDashboard'));
const HrPanel = lazy(() => import('./pages/HrPanel'));
const KalendarzZasobow = lazy(() => import('./pages/KalendarzZasobow'));
const MapaLive = lazy(() => import('./pages/MapaLive'));
const ArborSpecPage = lazy(() => import('./pages/ArborSpecPage'));

// Role constants — single source of truth for App.js route guards
const ADMIN   = ['Prezes', 'Dyrektor', 'Administrator'];
const MGMT    = [...ADMIN, 'Kierownik'];
const SALES   = [...MGMT, 'Dyrektor Sprzedazy', 'Dyrektor Sprzedaży', 'Dyrektor dzialu sprzedaz', 'Dyrektor działu sprzedaż'];
const WYCENY  = [...MGMT, 'Wyceniający', 'Wyceniajacy', 'Specjalista'];
const FINANCE = ['Prezes', 'Dyrektor', 'Administrator'];

function AuthenticatedRoute({ children }) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

function AppChrome() {
  const location = useLocation();
  const hideChat = location.pathname === '/' || location.pathname === '/login';
  return hideChat ? null : <AiChat />;
}

export function redirectCleanPathToHashRoute() {
  if (typeof window === 'undefined') return false;
  const { pathname, search, hash } = window.location;
  if (hash || !pathname || pathname === '/' || pathname === '/index.html') return false;

  const cleanPath = pathname.replace(/\/+$/, '') || '/';
  const nextHash = `#${cleanPath}${search || ''}`;
  window.history.replaceState(null, '', `/${nextHash}`);
  return true;
}

function App() {
  redirectCleanPathToHashRoute();

  return (
    <ThemeProvider>
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppChrome />
        {DevPanel && (
          <Suspense fallback={null}>
            <DevPanel />
          </Suspense>
        )}
        <Suspense fallback={<div className="loading">Ladowanie...</div>}>
        <Routes>
          {/* Public */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<Login />} />
          <Route path="/arbor-os-spec" element={<ArborSpecPage />} />

          {/* All authenticated users */}
          <Route path="/dashboard" element={<AuthenticatedRoute><Dashboard /></AuthenticatedRoute>} />
          <Route path="/eksploruj" element={<AuthenticatedRoute><Eksploruj /></AuthenticatedRoute>} />
          <Route path="/profil/:userId" element={<AuthenticatedRoute><Profil /></AuthenticatedRoute>} />
          <Route path="/profil" element={<AuthenticatedRoute><Profil /></AuthenticatedRoute>} />
          <Route path="/powiadomienia" element={<AuthenticatedRoute><Powiadomienia /></AuthenticatedRoute>} />
          <Route path="/zadania" element={<AuthenticatedRoute><ZadaniaOperatora /></AuthenticatedRoute>} />
          <Route path="/potwierdzenia-ekip" element={<AuthenticatedRoute><PotwierdzeniaEkip /></AuthenticatedRoute>} />
          <Route path="/zlecenia" element={<AuthenticatedRoute><Zlecenia /></AuthenticatedRoute>} />
          <Route path="/zlecenia/:id" element={<AuthenticatedRoute><Zlecenia /></AuthenticatedRoute>} />
          <Route path="/raporty" element={<AuthenticatedRoute><RaportyCentrum /></AuthenticatedRoute>} />
          <Route path="/raporty/analityka" element={<AuthenticatedRoute><Raporty /></AuthenticatedRoute>} />
          <Route path="/raporty/dzienny" element={<AuthenticatedRoute><RaportDzienny /></AuthenticatedRoute>} />
          <Route path="/raporty/mobilne" element={<AuthenticatedRoute><RaportyMobilne /></AuthenticatedRoute>} />
          <Route path="/raporty/kpi-tydzien" element={<AuthenticatedRoute><KpiTydzien /></AuthenticatedRoute>} />
          <Route path="/raporty/misja-dnia" element={<AuthenticatedRoute><MisjaDnia /></AuthenticatedRoute>} />
          <Route path="/raporty/autoplan" element={<AuthenticatedRoute><AutoplanDnia /></AuthenticatedRoute>} />
          <Route path="/misja-dnia" element={<AuthenticatedRoute><MisjaDnia /></AuthenticatedRoute>} />
          <Route path="/autoplan-dnia" element={<AuthenticatedRoute><AutoplanDnia /></AuthenticatedRoute>} />

          {/* Redirects */}
          <Route path="/raport-dzienny" element={<Navigate to="/raporty/dzienny" replace />} />
          <Route path="/raporty-mobilne" element={<Navigate to="/raporty/mobilne" replace />} />
          <Route path="/kpi-tydzien" element={<Navigate to="/raporty/kpi-tydzien" replace />} />

          {/* Field + management */}
          <Route path="/harmonogram" element={<AuthenticatedRoute><Harmonogram /></AuthenticatedRoute>} />
          <Route path="/wycena-rysuj" element={<AuthenticatedRoute><WycenaRysuj /></AuthenticatedRoute>} />
          <Route path="/ogledziny" element={<AuthenticatedRoute><Ogledziny /></AuthenticatedRoute>} />
          <Route path="/ogledziny-dokumentacja" element={<AuthenticatedRoute><OgledzinyDokumentacja /></AuthenticatedRoute>} />
          <Route path="/flota" element={<AuthenticatedRoute><Flota /></AuthenticatedRoute>} />
          <Route path="/magazyn" element={<AuthenticatedRoute><MagazynWeb /></AuthenticatedRoute>} />
          <Route path="/rezerwacje-sprzetu" element={<AuthenticatedRoute><RezerwacjeSprzetu /></AuthenticatedRoute>} />
          <Route path="/kalendarz-zasobow" element={<AuthenticatedRoute><KalendarzZasobow /></AuthenticatedRoute>} />
          <Route path="/mapa-live" element={
            <ProtectedRoute roles={MGMT}><MapaLive /></ProtectedRoute>
          } />

          {/* Quotation / estimator */}
          <Route path="/wycena-kalendarz" element={
            <ProtectedRoute roles={WYCENY}><WycenaKalendarz /></ProtectedRoute>
          } />
          <Route path="/blokady-kalendarza" element={
            <ProtectedRoute roles={WYCENY}><BlokadyKalendarza /></ProtectedRoute>
          } />
          <Route path="/zatwierdz-wyceny" element={
            <ProtectedRoute roles={WYCENY}><ZatwierdzWyceny /></ProtectedRoute>
          } />
          <Route path="/wyceny-terenowe/:id" element={
            <ProtectedRoute roles={WYCENY}><WycenaTerenowaDetail /></ProtectedRoute>
          } />
          <Route path="/wyceny-terenowe" element={
            <ProtectedRoute roles={WYCENY}><WycenyTerenowe /></ProtectedRoute>
          } />
          <Route path="/wyceniajacy-hub" element={
            <ProtectedRoute roles={WYCENY}><WyceniajacyHub /></ProtectedRoute>
          } />

          {/* CRM / Sales */}
          <Route path="/klienci" element={
            <ProtectedRoute roles={SALES}><Klienci /></ProtectedRoute>
          } />
          <Route path="/crm" element={
            <ProtectedRoute roles={SALES}><Crm /></ProtectedRoute>
          } />
          <Route path="/crm/hub" element={
            <ProtectedRoute roles={SALES}><Crm /></ProtectedRoute>
          } />
          <Route path="/crm/dashboard" element={
            <ProtectedRoute roles={SALES}><CrmDashboard /></ProtectedRoute>
          } />
          <Route path="/crm/inbox" element={
            <ProtectedRoute roles={SALES}><CrmInbox /></ProtectedRoute>
          } />
          <Route path="/crm/pipeline" element={
            <ProtectedRoute roles={SALES}><CrmPipeline /></ProtectedRoute>
          } />

          {/* Management (Kierownik+) */}
          <Route path="/nowe-zlecenie" element={
            <ProtectedRoute roles={MGMT}><NoweZlecenie /></ProtectedRoute>
          } />
          <Route path="/kierownik" element={
            <ProtectedRoute roles={MGMT}><Kierownik /></ProtectedRoute>
          } />
          <Route path="/kontrola-operacyjna" element={
            <ProtectedRoute roles={ADMIN}><KontrolaOperacyjna /></ProtectedRoute>
          } />
          <Route path="/ekipy" element={
            <ProtectedRoute roles={MGMT}><Ekipy /></ProtectedRoute>
          } />
          <Route path="/ranking-brygad" element={
            <ProtectedRoute roles={MGMT}><RankingBrygad /></ProtectedRoute>
          } />
          <Route path="/auto-dispatch" element={
            <ProtectedRoute roles={MGMT}><AutoDispatch /></ProtectedRoute>
          } />
          <Route path="/bi" element={
            <ProtectedRoute roles={MGMT}><BiDashboard /></ProtectedRoute>
          } />
          <Route path="/hr" element={
            <ProtectedRoute roles={MGMT}><HrPanel /></ProtectedRoute>
          } />
          <Route path="/telefonia" element={
            <ProtectedRoute roles={MGMT}><Telefonia /></ProtectedRoute>
          } />
          <Route path="/integracje" element={
            <ProtectedRoute roles={MGMT}><Integracje /></ProtectedRoute>
          } />
          <Route path="/zgloszenia-demo" element={
            <ProtectedRoute roles={ADMIN}><DemoRequests /></ProtectedRoute>
          } />
          <Route path="/kadry-dokumenty" element={
            <ProtectedRoute roles={MGMT}><KadryDokumenty /></ProtectedRoute>
          } />
          <Route path="/kadry-dokumenty/druk/:userId" element={
            <ProtectedRoute roles={MGMT}><KartaStanowiskaDruk /></ProtectedRoute>
          } />
          <Route path="/rozliczenia-polowe" element={
            <ProtectedRoute roles={[...MGMT, 'Brygadzista']}><RozliczeniaFieldEntry /></ProtectedRoute>
          } />

          {/* Finance — Dyrektor/Admin only */}
          <Route path="/ksiegowosc" element={
            <ProtectedRoute roles={FINANCE}><Ksiegowosc /></ProtectedRoute>
          } />
          <Route path="/wynagrodzenie-wyceniajacych" element={
            <ProtectedRoute roles={[...FINANCE, 'Kierownik', 'Wyceniający', 'Wyceniajacy']}><WynagrodzenieWyceniajacych /></ProtectedRoute>
          } />
          <Route path="/rozliczenia-ekip" element={
            <ProtectedRoute roles={MGMT}><PayrollM11 /></ProtectedRoute>
          } />

          {/* Admin only */}
          <Route path="/uzytkownicy" element={
            <ProtectedRoute roles={ADMIN}><Uzytkownicy /></ProtectedRoute>
          } />
          <Route path="/uzytkownicy/:id" element={
            <ProtectedRoute roles={ADMIN}><UzytkownikDetail /></ProtectedRoute>
          } />
          <Route path="/nowy-pracownik" element={
            <ProtectedRoute roles={MGMT}><NowyPracownik /></ProtectedRoute>
          } />
          <Route path="/oddzialy" element={
            <ProtectedRoute roles={ADMIN}><Oddzialy /></ProtectedRoute>
          } />
          <Route path="/oddzialy/:id" element={
            <ProtectedRoute roles={ADMIN}><OddzialDetail /></ProtectedRoute>
          } />
          <Route path="/zarzadzaj-rolami" element={
            <ProtectedRoute roles={ADMIN}><ZarzadzajRolami /></ProtectedRoute>
          } />

          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
        </Suspense>
      </HashRouter>
    </ThemeProvider>
  );
}

export default App;
