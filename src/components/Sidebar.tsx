import React, { useEffect, useState } from 'react';
import { 
  db, 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  doc, 
  deleteDoc, 
  setDoc,
  handleFirestoreError,
  OperationType
} from './firebase';
import { Conversation, ProviderState } from './types';
import { 
  MessageSquare, 
  Plus, 
  Trash2, 
  Activity, 
  Cpu, 
  Search, 
  Menu, 
  X,
  Zap,
  Globe,
  ChevronDown,
  Check
} from 'lucide-react';
import { translations, languages, Language } from '../translations';

interface SidebarProps {
  currentConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onCreateNewConversation: () => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  language: Language;
  onLanguageChange: (lang: Language) => void;
  onOpenSettings: () => void;
  logoVersion?: number;
}

export default function Sidebar({
  currentConversationId,
  onSelectConversation,
  onCreateNewConversation,
  isOpen,
  setIsOpen,
  language,
  onLanguageChange,
  onOpenSettings,
  logoVersion = Date.now()
}: SidebarProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [providers, setProviders] = useState<ProviderState[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCheckingProviders, setIsCheckingProviders] = useState(false);
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);

  const t = translations[language];
  const currentLang = languages.find(l => l.id === language);

  // 1. Subscribe to conversations in Firestore
  useEffect(() => {
    const q = query(collection(db, 'conversations'), orderBy('updatedAt', 'desc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: Conversation[] = [];
      snapshot.forEach((docSnapshot) => {
        list.push({ id: docSnapshot.id, ...docSnapshot.data() } as Conversation);
      });
      setConversations(list);
    }, (error) => {
      console.error("Firestore loading error:", error);
      handleFirestoreError(error, OperationType.LIST, 'conversations');
    });

    return () => unsubscribe();
  }, []);

  // 2. Poll providers status
  const checkProvidersStatus = async () => {
    setIsCheckingProviders(true);
    try {
      const res = await fetch('/api/providers/status');
      if (res.ok) {
        const data = await res.json();
        setProviders(data);
      }
    } catch (e) {
      console.error("Failed to check provider statuses", e);
    } finally {
      setIsCheckingProviders(false);
    }
  };

  useEffect(() => {
    checkProvidersStatus();
    // Refresh every 30 seconds
    const interval = setInterval(checkProvidersStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  // 3. Delete a conversation from Firestore
  const handleDeleteConversation = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm("Voulez-vous vraiment supprimer cette conversation ?")) {
      try {
        await deleteDoc(doc(db, 'conversations', id));
        if (currentConversationId === id) {
          // If the deleted one was selected, the App state will handle resetting
          onCreateNewConversation();
        }
      } catch (err) {
        console.error("Error deleting conversation:", err);
        handleFirestoreError(err, OperationType.DELETE, `conversations/${id}`);
      }
    }
  };

  // Filter conversations
  const filteredConversations = conversations.filter(c => 
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#0c0c0e] border-r border-zinc-800/80 text-zinc-300">
      {/* Header & New Chat button */}
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-zinc-900 rounded-xl overflow-hidden border border-zinc-800 shadow-sm">
              <img 
                src={`/logo.png?v=${logoVersion}`} 
                alt="Logo" 
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = 'https://api.dicebear.com/7.x/bottts/svg?seed=Cephboy&backgroundColor=ea580c';
                }}
              />
            </div>
            <div>
              <h1 className="font-sans font-bold text-base tracking-tight text-zinc-100">
                {t.appName}
              </h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider">{t.online}</span>
              </div>
            </div>
          </div>
          <button 
            className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            onClick={() => setIsOpen(false)}
            title={t.close}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <button
          onClick={() => {
            onCreateNewConversation();
            if (window.innerWidth < 768) setIsOpen(false);
          }}
          className="flex items-center justify-center gap-2.5 w-full py-2.5 px-4 bg-orange-600 hover:bg-orange-500 active:bg-orange-700 text-white font-bold rounded-xl transition-all duration-150 cursor-pointer text-sm shadow-md shadow-orange-600/15 group"
        >
          <Plus className="w-4 h-4 transition-transform group-hover:rotate-90" />
          {t.newChat}
        </button>

        {/* Language Selector */}
        <div className="mt-1 relative">
          <button
            onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
            className="w-full flex items-center justify-between px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-200 hover:bg-zinc-850 transition-colors shadow-xs cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Globe className="w-3.5 h-3.5 text-orange-500" />
              <span className="font-medium">{currentLang?.flag} {currentLang?.name}</span>
            </div>
            <ChevronDown className={`w-3 h-3 text-zinc-400 transition-transform ${isLangMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {isLangMenuOpen && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl z-50 py-1 max-h-48 overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-200">
              {languages.map((lang) => (
                <button
                  key={lang.id}
                  onClick={() => {
                    onLanguageChange(lang.id as Language);
                    setIsLangMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2.5 text-xs transition-colors hover:bg-zinc-850 cursor-pointer ${language === lang.id ? 'text-orange-500 bg-orange-950/40 font-semibold' : 'text-zinc-300'}`}
                >
                  <span>{lang.flag} {lang.name}</span>
                  {language === lang.id && <Check className="w-3 h-3" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Filter search bar */}
      <div className="px-4 mb-2">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder={t.conversations + "..."}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2 pl-10 pr-4 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 transition-colors shadow-xs"
          />
        </div>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        <div className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider px-2 mb-2 mt-2">{t.conversations}</div>
        {filteredConversations.length === 0 ? (
          <div className="text-center py-12 px-4 flex flex-col items-center gap-3">
            <MessageSquare className="w-10 h-10 text-zinc-800" />
            <p className="text-xs text-zinc-500">
              {searchQuery ? "Aucun résultat" : t.noConversations}
            </p>
          </div>
        ) : (
          filteredConversations.map((chat) => {
            const isSelected = chat.id === currentConversationId;
            return (
              <div
                key={chat.id}
                onClick={() => {
                  onSelectConversation(chat.id);
                  if (window.innerWidth < 768) setIsOpen(false);
                }}
                className={`group flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition duration-150 ${
                  isSelected 
                    ? 'bg-orange-950/40 text-orange-400 border-l-4 border-orange-500 font-semibold shadow-xs' 
                    : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <MessageSquare className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-orange-500' : 'text-zinc-500'}`} />
                  <span className="text-sm truncate pr-2">
                    {chat.title || "Chat sans titre"}
                  </span>
                </div>
                <button
                  onClick={(e) => handleDeleteConversation(e, chat.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 rounded transition-opacity cursor-pointer"
                  title="Supprimer la conversation"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Settings Button Only */}
      <div className="p-4 border-t border-zinc-800 bg-zinc-900/20 font-sans">
        <button
          onClick={onOpenSettings}
          className="w-full text-[11px] bg-zinc-900 hover:bg-zinc-850 text-zinc-300 px-3 py-2.5 rounded-lg border border-zinc-800 transition flex items-center justify-center gap-2 group shadow-xs cursor-pointer font-semibold"
        >
          <Activity className="w-3.5 h-3.5 text-zinc-400 group-hover:text-orange-500 transition-colors" />
          {t.settings}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className={`flex-shrink-0 h-screen hidden md:block select-none transition-all duration-300 ease-in-out border-r border-zinc-800/80 ${isOpen ? 'w-80 opacity-100' : 'w-0 opacity-0 overflow-hidden'}`}>
        <div className="w-80 h-full">
          {sidebarContent}
        </div>
      </aside>

      {/* Mobile Sidebar overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
            onClick={() => setIsOpen(false)}
          />
          <div className="relative flex flex-col w-4/5 max-w-sm h-full bg-[#0c0c0e] border-r border-zinc-800/80 transform transition-transform duration-300 ease-in-out">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}
