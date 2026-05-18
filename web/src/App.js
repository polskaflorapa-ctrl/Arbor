import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './ThemeContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Zlecenia from './pages/Zlecenia';
import ZlecenieDetail from './pages/ZlecenieDetail';
import NoweZlecenie from './pages/NoweZlecenie';
import Kierownik from './pages/Kierownik';
import Ekipy from './pages/Ekipy';
import RaportyCentrum from './pages/RaportyCentrum';
import Raporty from './pages/Raporty';
import RaportDzienny from './pages/RaportDzienny';
import RaportyMobilne from './pages/RaportyMobilne';
import KpiTydzien from './pages/KpiTydzien';
import MisjaDnia from './pages/MisjaDnia';
import AutoplanDnia from './pages/AutoplanDnia';
import Uzytkownicy from './pages/Uzytkownicy';
import UzytkownikDetail from './pages/UzytkownikDetail';
import NowyPracownik from './pages/NowyPracownik';
import Oddzialy from './pages/Oddzialy';
import OddzialDetail from './pages/OddzialDetail';
import Flota from './pages/Flota';
import MagazynWeb from './pages/MagazynWeb';
import RezerwacjeSprzetu from './pages/RezerwacjeSprzetu';
import PotwierdzeniaEkip from './pages/PotwierdzeniaEkip';
import Crm from './pages/Crm';
import CrmDashboard from './pages/CrmDashboard';
import CrmPipeline from './pages/CrmPipeline';
import Powiadomienia from './pages/Powiadomienia';
import Telefonia from './pages/Telefonia';
import Harmonogram from './pages/Harmonogram';
import Ksiegowosc from './pages/Ksiegowosc';
import WycenaKalendarz from './pages/WycenaKalendarz';
import BlokadyKalendarza from './pages/BlokadyKalendarza';
import WycenaRysuj from './pages/WycenaRysuj';
import ZatwierdzWyceny from './pages/ZatwierdzWyceny';
import WycenyTerenowe from './pages/WycenyTerenowe';
import WycenaTerenowaDetail from './pages/WycenaTerenowaDetail';
import ZarzadzajRolami from './pages/ZarzadzajRolami';
import Klienci from './pages/Klienci';
import Ogledziny from './pages/Ogledziny';
import OgledzinyDokumentacja from './pages/OgledzinyDokumentacja';
import WyceniajacyHub from './pages/WyceniajacyHub';
import Profil from './pages/Profil';
import ZadaniaOperatora from './pages/ZadaniaOperatora';
import KadryDokumenty from './pages/KadryDokumenty';
import KartaStanowiskaDruk from './pages/KartaStanowiskaDruk';
import WynagrodzenieWyceniajacych from './pages/WynagrodzenieWyceniajacych';
import PayrollM11 from './pages/PayrollM11';
import Integracje from './pages/Integracje';
import Eksploruj from './pages/Eksploruj';
import RozliczeniaFieldEntry from './pages/RozliczeniaFieldEntry';
import AutoDispatch from './pages/AutoDispatch';
import BiDashboard from './pages/BiDashboard';
import HrPanel from './pages/HrPanel';
import KalendarzZasobow from './pages/KalendarzZasobow';
import AiChat from './components/AiChat';
import { DevPanel } from './components/DevPanel';

// Role constants — single source of truth for App.js route guards
const ADMIN   = ['Prezes', 'Dyrektor', 'Administrator'];
const MGMT    = [...ADMIN, 'Kierownik'];
const SALES   = [...MGMT, 'Dyrektor Sprzedazy', 'Dyrektor Sprzedaży', 'Dyrektor dzialu sprzedaz', 'Dyrektor działu sprzedaż'];
const WYCENY  = [...MGMT, 'Wyceniający', 'Wyceniajacy', 'Specjalista'];
const FINANCE = ['Prezes', 'Dyrektor', 'Administrator'];

function App() {
  return (
    <ThemeProvider>
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AiChat />
        <DevPanel />
        <Routes>
          {/* Public */}
          <Route path="/" element={<Login />} />

          {/* All authenticated users */}
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/eksploruj" element={<Eksploruj />} />
          <Route path="/profil/:userId" element={<Profil />} />
          <Route path="/profil" element={<Profil />} />
          <Route path="/powiadomienia" element={<Powiadomienia />} />
          <Route path="/zadania" element={<ZadaniaOperatora />} />
          <Route path="/potwierdzenia-ekip" element={<PotwierdzeniaEkip />} />
          <Route path="/zlecenia" element={<Zlecenia />} />
          <Route path="/zlecenia/:id" element={<ZlecenieDetail />} />
          <Route path="/raporty" element={<RaportyCentrum />} />
          <Route path="/raporty/analityka" element={<Raporty />} />
          <Route path="/raporty/dzienny" element={<RaportDzienny />} />
          <Route path="/raporty/mobilne" element={<RaportyMobilne />} />
          <Route path="/raporty/kpi-tydzien" element={<KpiTydzien />} />
          <Route path="/raporty/misja-dnia" element={<MisjaDnia />} />
          <Route path="/raporty/autoplan" element={<AutoplanDnia />} />
          <Route path="/misja-dnia" element={<MisjaDnia />} />
          <Route path="/autoplan-dnia" element={<AutoplanDnia />} />

          {/* Redirects */}
          <Route path="/raport-dzienny" element={<Navigate to="/raporty/dzienny" replace />} />
          <Route path="/raporty-mobilne" element={<Navigate to="/raporty/mobilne" replace />} />
          <Route path="/kpi-tydzien" element={<Navigate to="/raporty/kpi-tydzien" replace />} />

          {/* Field + management */}
          <Route path="/harmonogram" element={<Harmonogram />} />
          <Route path="/wycena-rysuj" element={<WycenaRysuj />} />
          <Route path="/ogledziny" element={<Ogledziny />} />
          <Route path="/ogledziny-dokumentacja" element={<OgledzinyDokumentacja />} />
          <Route path="/flota" element={<Flota />} />
          <Route path="/magazyn" element={<MagazynWeb />} />
          <Route path="/rezerwacje-sprzetu" element={<RezerwacjeSprzetu />} />
          <Route path="/kalendarz-zasobow" element={<KalendarzZasobow />} />

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
          <Route path="/crm/dashboard" element={
            <ProtectedRoute roles={SALES}><CrmDashboard /></ProtectedRoute>
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
          <Route path="/ekipy" element={
            <ProtectedRoute roles={MGMT}><Ekipy /></ProtectedRoute>
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
      </HashRouter>
    </ThemeProvider>
  );
}

export default App;
