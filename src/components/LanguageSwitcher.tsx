import React from 'react';
import { useTranslation } from 'react-i18next';

export const LanguageSwitcher: React.FC = () => {
  const { i18n } = useTranslation();

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  return (
    <div className="fixed top-2 right-2 flex gap-2 p-2 bg-white/80 backdrop-blur-sm rounded-lg shadow-sm border border-gray-100 z-50">
      <button 
        onClick={() => changeLanguage('fr')} 
        className={`px-2 py-1 text-xs rounded ${i18n.language === 'fr' ? 'bg-blue-100 text-blue-800' : 'hover:bg-gray-100'}`}
      >
        FR
      </button>
      <button 
        onClick={() => changeLanguage('en')} 
        className={`px-2 py-1 text-xs rounded ${i18n.language === 'en' ? 'bg-blue-100 text-blue-800' : 'hover:bg-gray-100'}`}
      >
        EN
      </button>
    </div>
  );
};
