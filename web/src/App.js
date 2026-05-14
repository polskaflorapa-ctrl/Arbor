import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './ThemeContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import MisjaDnia from './pages/MisjaDnia';
import AutoplanDnia from './pages/AutoplanDnia';
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
import AiChat from './components/AiChat';
import { DevPanel } from './components/DevPanel';

function App() {
  return (
    <ThemeProvider>
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AiChat />
        <DevPanel />
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/misja-dnia" element={<MisjaDnia />} />
          <Route path="/autoplan-dnia" element={<AutoplanDnia />} />
          <Route path="/zlecenia" element={<Zlecenia />} />
          <Route path="/zlecenia/:id" element={<ZlecenieDetail />} />
          <Route path="/nowe-zlecenie" element={<NoweZlecenie />} />
          <Route path="/kierownik" element={<Kierownik />} />
          <Route path="/ekipy" element={<Ekipy />} />
          <Route path="/raporty" element={<RaportyCentrum />} />
          <Route path="/raporty/analityka" element={<Raporty />} />
          <Route path="/raporty/dzienny" element={<RaportDzienny />} />
          <Route path="/raporty/mobilne" element={<RaportyMobilne />} />
          <Route path="/raporty/kpi-tydzien" element={<KpiTydzien />} />
          <Route path="/raporty/misja-dnia" element={<MisjaDnia />} />
          <Route path="/raporty/autoplan" element={<AutoplanDnia />} />
          <Route path="/raport-dzienny" element={<Navigate to="/raporty/dzienny" replace />} />
          <Route path="/raporty-mobilne" element={<Navigate to="/raporty/mobilne" replace />} />
          <Route path="/kpi-tydzien" element={<Navigate to="/raporty/kpi-tydzien" replace />} />
          <Route path="/misja-dnia" element={<Navigate to="/raporty/misja-dnia" replace />} />
          <Route path="/autoplan-dnia" element={<Navigate to="/raporty/autoplan" replace />} />
          <Route path="/uzytkownicy" element={<Uzytkownicy />} />
          <Route path="/uzytkownicy/:id" element={<UzytkownikDetail />} />
          <Route path="/nowy-pracownik" element={<NowyPracownik />} />
          <Route path="/oddzialy" element={<Oddzialy />} />
          <Route path="/oddzialy/:id" element={<OddzialDetail />} />
          <Route path="/flota" element={<Flota />} />
          <Route path="/magazyn" element={<MagazynWeb />} />
          <Route path="/rezerwacje-sprzetu" element={<RezerwacjeSprzetu />} />
          <Route path="/powiadomienia" element={<Powiadomienia />} />
          <Route path="/telefonia" element={<Telefonia />} />
          <Route path="/harmonogram" element={<Harmonogram />} />
          <Route path="/ksiegowosc" element={<Ksiegowosc />} />
          <Route path="/wycena-kalendarz" element={<WycenaKalendarz />} />
          <Route path="/blokady-kalendarza" element={<BlokadyKalendarza />} />
          <Route path="/wycena-rysuj" element={<WycenaRysuj />} />
          <Route path="/zatwierdz-wyceny" element={<ZatwierdzWyceny />} />
          <Route path="/wyceny-terenowe/:id" element={<WycenaTerenowaDetail />} />
          <Route path="/wyceny-terenowe" element={<WycenyTerenowe />} />
          <Route path="/zarzadzaj-rolami" element={<ZarzadzajRolami />} />
          <Route path="/klienci" element={<Klienci />} />
          <Route path="/crm" element={<Crm />} />
          <Route path="/crm/dashboard" element={<CrmDashboard />} />
          <Route path="/crm/pipeline" element={<CrmPipeline />} />
          <Route path="/ogledziny" element={<Ogledziny />} />
          <Route path="/ogledziny-dokumentacja" element={<OgledzinyDokumentacja />} />
          <Route path="/wyceniajacy-hub" element={<WyceniajacyHub />} />
          <Route path="/profil/:userId" element={<Profil />} />
          <Route path="/profil" element={<Profil />} />
          <Route path="/zadania" element={<ZadaniaOperatora />} />
          <Route path="/kadry-dokumenty" element={<KadryDokumenty />} />
          <Route path="/kadry-dokumenty/druk/:userId" element={<KartaStanowiskaDruk />} />
          <Route path="/wynagrodzenie-wyceniajacych" element={<WynagrodzenieWyceniajacych />} />
          <Route path="/rozliczenia-ekip" element={<PayrollM11 />} />
          <Route path="/integracje" element={<Integracje />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </HashRouter>
    </ThemeProvider>
  );
}

export default App;
