import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './ThemeContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Zlecenia from './pages/Zlecenia';
import ZlecenieDetail from './pages/ZlecenieDetail';
import NoweZlecenie from './pages/NoweZlecenie';
import Kierownik from './pages/Kierownik';
import Ekipy from './pages/Ekipy';
import Raporty from './pages/Raporty';
import Uzytkownicy from './pages/Uzytkownicy';
import UzytkownikDetail from './pages/UzytkownikDetail';
import NowyPracownik from './pages/NowyPracownik';
import Oddzialy from './pages/Oddzialy';
import OddzialDetail from './pages/OddzialDetail';
import Flota from './pages/Flota';
import Powiadomienia from './pages/Powiadomienia';
import Telefonia from './pages/Telefonia';
import Harmonogram from './pages/Harmonogram';
import Ksiegowosc from './pages/Ksiegowosc';
import WycenaKalendarz from './pages/WycenaKalendarz';
import ZatwierdzWyceny from './pages/ZatwierdzWyceny';
import ZarzadzajRolami from './pages/ZarzadzajRolami';
import Klienci from './pages/Klienci';
import Ogledziny from './pages/Ogledziny';
import WynagrodzenieWyceniajacych from './pages/WynagrodzenieWyceniajacych';
import Integracje from './pages/Integracje';
import AiChat from './components/AiChat';

function App() {
  return (
    <ThemeProvider>
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AiChat />
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/zlecenia" element={<Zlecenia />} />
          <Route path="/zlecenia/:id" element={<ZlecenieDetail />} />
          <Route path="/nowe-zlecenie" element={<NoweZlecenie />} />
          <Route path="/kierownik" element={<Kierownik />} />
          <Route path="/ekipy" element={<Ekipy />} />
          <Route path="/raporty" element={<Raporty />} />
          <Route path="/uzytkownicy" element={<Uzytkownicy />} />
          <Route path="/uzytkownicy/:id" element={<UzytkownikDetail />} />
          <Route path="/nowy-pracownik" element={<NowyPracownik />} />
          <Route path="/oddzialy" element={<Oddzialy />} />
          <Route path="/oddzialy/:id" element={<OddzialDetail />} />
          <Route path="/flota" element={<Flota />} />
          <Route path="/powiadomienia" element={<Powiadomienia />} />
          <Route path="/telefonia" element={<Telefonia />} />
          <Route path="/harmonogram" element={<Harmonogram />} />
          <Route path="/ksiegowosc" element={<Ksiegowosc />} />
          <Route path="/wycena-kalendarz" element={<WycenaKalendarz />} />
          <Route path="/zatwierdz-wyceny" element={<ZatwierdzWyceny />} />
          <Route path="/zarzadzaj-rolami" element={<ZarzadzajRolami />} />
          <Route path="/klienci" element={<Klienci />} />
          <Route path="/ogledziny" element={<Ogledziny />} />
          <Route path="/wynagrodzenie-wyceniajacych" element={<WynagrodzenieWyceniajacych />} />
          <Route path="/integracje" element={<Integracje />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </HashRouter>
    </ThemeProvider>
  );
}

export default App;
