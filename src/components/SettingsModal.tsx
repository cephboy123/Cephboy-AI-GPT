import { motion, AnimatePresence } from 'motion/react';
import { X, Globe, Image, Languages, Check, Search } from 'lucide-react';
import { translations, Language, languages } from '../translations';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  language: Language;
  onLanguageChange: (lang: Language) => void;
  searchWeb: boolean;
  setSearchWeb: (val: boolean) => void;
  isImageMode: boolean;
  setIsImageMode: (val: boolean) => void;
  imageEngine: 'pollinations' | 'gemini' | 'pixelapi';
  setImageEngine: (val: 'pollinations' | 'gemini' | 'pixelapi') => void;
  linkedinSearch: boolean;
  setLinkedinSearch: (val: boolean) => void;
}

export default function SettingsModal({
  isOpen,
  onClose,
  language,
  onLanguageChange,
  searchWeb,
  setSearchWeb,
  isImageMode,
  setIsImageMode,
  imageEngine,
  setImageEngine,
  linkedinSearch,
  setLinkedinSearch
}: SettingsModalProps) {
  const t = translations[language];

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-lg bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/5">
              <div className="flex items-center gap-2 text-white font-medium">
                <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center">
                  <Globe className="w-5 h-5 text-orange-400" />
                </div>
                {t.settingsTitle}
              </div>
              <button 
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-white transition rounded-lg hover:bg-white/5"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-8 max-h-[70vh] overflow-y-auto">
              {/* Language Selection */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  <Languages className="w-4 h-4" />
                  {t.selectLanguage}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {languages.map((lang) => (
                    <button
                      key={lang.id}
                      onClick={() => onLanguageChange(lang.id as Language)}
                      className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
                        language === lang.id 
                          ? 'bg-orange-500/10 border-orange-500/50 text-orange-400' 
                          : 'bg-white/5 border-transparent text-gray-400 hover:bg-white/10'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="text-lg leading-none">{lang.flag}</span>
                        <span className="text-sm">{lang.name}</span>
                      </span>
                      {language === lang.id && <Check className="w-4 h-4" />}
                    </button>
                  ))}
                </div>
              </section>

              {/* LinkedIn Integration */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  <Globe className="w-4 h-4" />
                  {t.linkedinIntegration}
                </div>
                <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 pr-4">
                      <div className="text-sm font-medium text-white">{t.linkedinIntegration}</div>
                      <div className="text-xs text-gray-500 mt-1">{t.linkedinDesc}</div>
                    </div>
                    <button
                      onClick={() => setLinkedinSearch(!linkedinSearch)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                        linkedinSearch ? 'bg-[#0077b5]' : 'bg-gray-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          linkedinSearch ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                  
                  {linkedinSearch && (
                    <div className="pt-4 border-t border-white/5 space-y-3">
                      <div className="bg-orange-500/10 border border-orange-500/20 p-3 rounded-xl">
                        <p className="text-[10px] text-orange-400 leading-relaxed">
                          Configurez vos clés <strong>LINKEDIN_CLIENT_ID</strong> et <strong>LINKEDIN_CLIENT_SECRET</strong> dans les paramètres d'environnement de l'application pour activer la recherche réelle.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* AI Features */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  <Search className="w-4 h-4" />
                  {t.aiSearch}
                </div>
                <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-white">{t.searchWeb}</div>
                      <div className="text-xs text-gray-500 mt-1">{t.aiSearchDesc}</div>
                    </div>
                    <button
                      onClick={() => setSearchWeb(!searchWeb)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                        searchWeb ? 'bg-orange-500' : 'bg-gray-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          searchWeb ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </section>

              {/* Image Generation */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  <Image className="w-4 h-4" />
                  {t.aiImages}
                </div>
                <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-white">{t.imageMode}</div>
                      <div className="text-xs text-gray-500 mt-1">{t.aiImageDesc}</div>
                    </div>
                    <button
                      onClick={() => setIsImageMode(!isImageMode)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                        isImageMode ? 'bg-orange-500' : 'bg-gray-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          isImageMode ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  {isImageMode && (
                    <div className="space-y-3 pt-4 border-t border-white/5">
                      <div className="text-xs font-medium text-gray-400">{t.imageEngine}</div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => setImageEngine('pollinations')}
                          className={`px-4 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                            imageEngine === 'pollinations'
                              ? 'bg-orange-500/10 border-orange-500/50 text-orange-400'
                              : 'bg-white/5 border-transparent text-gray-500 hover:bg-white/10'
                          }`}
                        >
                          Moteur Standard
                        </button>
                        <button
                          onClick={() => setImageEngine('gemini')}
                          className={`px-4 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                            imageEngine === 'gemini'
                              ? 'bg-orange-500/10 border-orange-500/50 text-orange-400'
                              : 'bg-white/5 border-transparent text-gray-500 hover:bg-white/10'
                          }`}
                        >
                          Moteur Premium
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* Footer */}
            <div className="p-6 bg-white/5 border-t border-white/5 flex justify-end">
              <button
                onClick={onClose}
                className="px-6 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-sm font-semibold transition shadow-lg shadow-orange-500/20"
              >
                {t.saveSettings}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
