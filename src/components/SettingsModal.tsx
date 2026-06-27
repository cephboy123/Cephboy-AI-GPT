import { motion, AnimatePresence } from 'motion/react';
import { X, Globe, Image, Languages, Check, Search, Cpu, AlertTriangle } from 'lucide-react';
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
  imageEngine: 'pollinations' | 'gemini' | 'pixelapi' | 'cloudflare';
  setImageEngine: (val: 'pollinations' | 'gemini' | 'pixelapi' | 'cloudflare') => void;
  linkedinSearch: boolean;
  setLinkedinSearch: (val: boolean) => void;
  preferCloudflare: boolean;
  setPreferCloudflare: (val: boolean) => void;
  selectedModel?: 'cephgpt1' | 'cephgpt2' | 'duo';
  onSelectedModelChange?: (val: 'cephgpt1' | 'cephgpt2' | 'duo') => void;
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
  setLinkedinSearch,
  preferCloudflare,
  setPreferCloudflare,
  selectedModel = 'duo',
  onSelectedModelChange
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
            className="relative w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center gap-2 text-slate-900 font-bold">
                <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center">
                  <Globe className="w-5 h-5 text-orange-600" />
                </div>
                {t.settingsTitle}
              </div>
              <button 
                onClick={onClose}
                className="p-2 text-slate-400 hover:text-slate-600 transition rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-8 max-h-[70vh] overflow-y-auto bg-white">
              {/* Language Selection */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  <Languages className="w-4 h-4 text-slate-400" />
                  {t.selectLanguage}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {languages.map((lang) => (
                    <button
                      key={lang.id}
                      onClick={() => onLanguageChange(lang.id as Language)}
                      className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-all cursor-pointer ${
                        language === lang.id 
                          ? 'bg-orange-50 border-orange-200 text-orange-600 font-semibold' 
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
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

              {/* Engine Selection */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  <Cpu className="w-4 h-4 text-slate-400" />
                  Choix de l'Assistant IA
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => onSelectedModelChange?.('cephgpt1')}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all cursor-pointer ${
                      selectedModel === 'cephgpt1'
                        ? 'bg-orange-50 border-orange-300 text-orange-600 font-bold'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <span className="text-sm">CephGPT-1</span>
                    <span className="text-[9px] text-slate-400 mt-1 leading-none font-medium">Rapide • Gemini</span>
                  </button>
                  <button
                    onClick={() => onSelectedModelChange?.('cephgpt2')}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all cursor-pointer ${
                      selectedModel === 'cephgpt2'
                        ? 'bg-orange-50 border-orange-300 text-orange-600 font-bold'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <span className="text-sm">CephGPT-2</span>
                    <span className="text-[9px] text-slate-400 mt-1 leading-none font-medium">Smart • Cloudflare</span>
                  </button>
                  <button
                    onClick={() => onSelectedModelChange?.('duo')}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all cursor-pointer ${
                      selectedModel === 'duo'
                        ? 'bg-orange-50 border-orange-300 text-orange-600 font-bold'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <span className="text-sm font-bold">Mode Duo</span>
                    <span className="text-[9px] text-slate-400 mt-1 leading-none font-medium">Collaboratif • Auto</span>
                  </button>
                </div>
              </section>

              {/* LinkedIn Integration */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  <Globe className="w-4 h-4 text-slate-400" />
                  {t.linkedinIntegration}
                </div>
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 pr-4">
                      <div className="text-sm font-semibold text-slate-850">{t.linkedinIntegration}</div>
                      <div className="text-xs text-slate-500 mt-1">{t.linkedinDesc}</div>
                    </div>
                    <button
                      onClick={() => setLinkedinSearch(!linkedinSearch)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none cursor-pointer ${
                        linkedinSearch ? 'bg-[#0077b5]' : 'bg-slate-200'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          linkedinSearch ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </section>

              {/* AI Features */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  <Search className="w-4 h-4 text-slate-400" />
                  {t.aiSearch}
                </div>
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-850">{t.searchWeb}</div>
                      <div className="text-xs text-slate-500 mt-1">{t.aiSearchDesc}</div>
                    </div>
                    <button
                      onClick={() => setSearchWeb(!searchWeb)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none cursor-pointer ${
                        searchWeb ? 'bg-orange-600' : 'bg-slate-200'
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
                <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  <Image className="w-4 h-4 text-slate-400" />
                  {t.aiImages}
                </div>
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-850">{t.imageMode}</div>
                      <div className="text-xs text-slate-500 mt-1">{t.aiImageDesc}</div>
                    </div>
                    <button
                      onClick={() => setIsImageMode(!isImageMode)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none cursor-pointer ${
                        isImageMode ? 'bg-orange-600' : 'bg-slate-200'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          isImageMode ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </section>

              {/* Disclaimer */}
              <div className="flex gap-3 p-4 rounded-xl bg-amber-50 border border-amber-100 text-amber-800 text-xs shadow-xs">
                <AlertTriangle className="w-4.5 h-4.5 text-amber-600 flex-shrink-0 mt-0.5" />
                <span className="font-medium leading-relaxed">{t.disclaimer}</span>
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                onClick={onClose}
                className="px-6 py-2.5 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-sm font-bold transition shadow-md shadow-orange-600/10 cursor-pointer"
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
