import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import pl from './locales/pl.json';
import uk from './locales/uk.json';
import ru from './locales/ru.json';

const htmlLang = (lng) => {
  const base = String(lng || 'pl').split('-')[0];
  if (base === 'uk') return 'uk';
  if (base === 'ru') return 'ru';
  return 'pl';
};

i18n.on('languageChanged', (lng) => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = htmlLang(lng);
  }
});

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      pl: { translation: pl },
      uk: { translation: uk },
      ru: { translation: ru },
    },
    fallbackLng: 'pl',
    supportedLngs: ['pl', 'uk', 'ru'],
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'arbor_lang',
    },
  });

if (typeof document !== 'undefined') {
  document.documentElement.lang = htmlLang(i18n.language);
}

export default i18n;
