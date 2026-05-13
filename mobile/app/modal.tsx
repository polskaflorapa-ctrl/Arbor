// Plik-relikt po `create-expo-app` — przekierowanie na ekran startowy.
// Cały moduł (wraz z components/themed-{text,view}, hooks/use-color-scheme,
// hooks/use-theme-color) można bezpiecznie usunąć — nie jest importowany
// przez żadną żywą część aplikacji.
import { Redirect } from 'expo-router';

export default function ModalScreen() {
  return <Redirect href="/" />;
}
