import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        translation: {
          'language': 'Language',
          'chat_placeholder': 'Type your message...',
        },
      },
      fr: {
        translation: {
          'language': 'Langue',
          'chat_placeholder': 'Tapez votre message...',
        },
      },
    },
    fallbackLng: 'fr',
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
