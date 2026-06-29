import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import { translations, Language } from './translations';
import { Conversation, Message, Citation, saveConversationToLocalCache, getConversationFromLocalCache } from './components/types';
import { Cpu, X, Check, Search, ExternalLink, Activity, Zap, RefreshCw } from 'lucide-react';
import { 
  getDb, 
  collection, 
  doc, 
  setDoc, 
  getDoc,
  deleteDoc,
  getAuthInstance,
  signInAnonymously,
  onAuthStateChanged,
  handleFirestoreError,
  OperationType,
  firebaseConfig,
  query,
  where,
  getDocs
} from './components/firebase';

export default function App() {
  const [userId, setUserId] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authErrorCode, setAuthErrorCode] = useState<string | null>(null);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(() => localStorage.getItem('cephboy-current-conv-id'));
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentProvider, setCurrentProvider] = useState<string>('');
  const [currentStatusText, setCurrentStatusText] = useState<string>('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [searchWeb, setSearchWeb] = useState(false);
  const [linkedinSearch, setLinkedinSearch] = useState(false);
  const [isImageMode, setIsImageMode] = useState(false);
  const [imageEngine, setImageEngine] = useState<'pollinations' | 'gemini' | 'pixelapi' | 'cloudflare'>('pollinations');
  const [preferCloudflare, setPreferCloudflare] = useState<boolean>(() => localStorage.getItem('prefer-cloudflare') === 'true');
  const [selectedModel, setSelectedModel] = useState<'cephgpt1' | 'cephgpt2' | 'duo'>(() => {
    return (localStorage.getItem('selected-model') as 'cephgpt1' | 'cephgpt2' | 'duo') || 'duo';
  });

  const saveSafe = async (id: string, conv: Conversation) => {
    const MAX_MESSAGES = 40;
    const truncatedConv = {
      ...conv,
      messages: conv.messages.length > MAX_MESSAGES 
          ? conv.messages.slice(-MAX_MESSAGES)
          : conv.messages
    };
    if (truncatedConv.userId === undefined) {
      truncatedConv.userId = null as any; // Firestore does not support undefined
    }
    await setDoc(doc(getDb(), 'conversations', id), truncatedConv);
  };

  const handleSetSelectedModel = (val: 'cephgpt1' | 'cephgpt2' | 'duo') => {
    setSelectedModel(val);
    localStorage.setItem('selected-model', val);
  };

  const handleSetPreferCloudflare = (val: boolean) => {
    setPreferCloudflare(val);
    localStorage.setItem('prefer-cloudflare', String(val));
  };
  const [language, setLanguage] = useState<Language>(() => {
    const override = localStorage.getItem('app-language-override');
    if (override && override !== 'auto') return override as Language;
    
    if (typeof navigator !== 'undefined') {
      // Use languages array first as it's more comprehensive on mobile
      const browserLanguages = navigator.languages || [navigator.language];
      for (const lang of browserLanguages) {
        const browserLang = lang.split(/[-_]/)[0].toLowerCase();
        const supportedLanguages = ['fr', 'en', 'es', 'ar', 'zh', 'ru', 'pt', 'de', 'ja', 'it'];
        if (supportedLanguages.includes(browserLang)) {
          return browserLang as Language;
        }
      }
    }
    return 'fr'; // Solid default for this app
  });

  const t = translations[language];

  // System language listener
  useEffect(() => {
    const handleSystemLanguageChange = () => {
      const override = localStorage.getItem('app-language-override');
      if (!override && typeof navigator !== 'undefined') {
        const currentLang = (navigator.languages && navigator.languages.length > 0) 
          ? navigator.languages[0] 
          : navigator.language;
          
        if (currentLang) {
          const browserLang = currentLang.split('-')[0].toLowerCase();
          const supportedLanguages = ['fr', 'en', 'es', 'ar', 'zh', 'ru', 'pt', 'de', 'ja', 'it'];
          if (supportedLanguages.includes(browserLang)) {
            setLanguage(browserLang as Language);
          } else {
            setLanguage('fr');
          }
        }
      }
    };
    
    // Check once on mount to ensure we have the most up-to-date language
    handleSystemLanguageChange();

    window.addEventListener('languagechange', handleSystemLanguageChange);
    
    // Handle tab visibility change (especially useful on mobile when returning from settings)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleSystemLanguageChange();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      window.removeEventListener('languagechange', handleSystemLanguageChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const [isRetryingAuth, setIsRetryingAuth] = useState(false);

  const migrateConversations = async (oldId: string, newId: string) => {
    if (!oldId || !newId || oldId === newId) return;
    try {
      const q = query(collection(getDb(), "conversations"), where("userId", "==", oldId));
      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        localStorage.removeItem('cephboy-local-session-id');
        return;
      }
      
      console.log(`Migration: Found ${snapshot.size} conversations to migrate from ${oldId} to ${newId}`);
      
      for (const d of snapshot.docs) {
        await setDoc(doc(getDb(), "conversations", d.id), { userId: newId }, { merge: true });
        console.log(`Migration: Migrated doc ${d.id}`);
      }
      
      localStorage.removeItem('cephboy-local-session-id');
      console.log("Migration: Completed successfully");
    } catch (e) {
      console.error("Migration failed:", e);
    }
  };

  // 0. Handle Authentication
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getAuthInstance(), (user) => {
      if (user) {
        console.log("Auth: Authenticated as", user.uid);
        setUserId(user.uid);
        setAuthError(null);
        setIsRetryingAuth(false);

        // Try to migrate local conversations if they exist
        const localId = localStorage.getItem('cephboy-local-session-id');
        if (localId && localId !== user.uid) {
          migrateConversations(localId, user.uid);
        }
      } else {
        console.log("Auth: Not authenticated, attempting anonymous sign-in...");
        signInAnonymously(getAuthInstance()).catch((err) => {
          console.error("Auth: Anonymous sign-in failed:", err.message);
          
          let localId = localStorage.getItem('cephboy-local-session-id');
          if (!localId) {
            localId = 'anon_' + Math.random().toString(36).substring(2, 15);
            localStorage.setItem('cephboy-local-session-id', localId);
          }
          setUserId(localId);
          setIsRetryingAuth(false);

          if (err.code === 'auth/admin-restricted-operation' || err.code === 'auth/operation-not-allowed') {
            const isFr = language === 'fr';
            setAuthError(isFr 
              ? "L'authentification anonyme est désactivée. Vous DEVEZ l'activer dans la console Firebase (Onglet Authentification)." 
              : "Anonymous authentication is disabled. You MUST enable it in the Firebase Console (Authentication tab).");
          }
        });
      }
    });
    return () => unsubscribe();
  }, [language]);

  const performAuthRetry = async () => {
    setIsRetryingAuth(true);
    setAuthError(null);
    setAuthErrorCode(null);
    try {
      console.log("Auth: Retrying sign-in...");
      await signInAnonymously(getAuthInstance());
      // onAuthStateChanged will handle the rest
      console.log("Auth: Sign-in command sent successfully");
    } catch (err: any) {
      console.error("Auth: Manual retry failed:", err.code, err.message);
      setAuthErrorCode(err.code);
      if (err.code === 'auth/admin-restricted-operation' || err.code === 'auth/operation-not-allowed') {
        const isFr = language === 'fr';
        setAuthError(isFr 
          ? "L'authentification anonyme est désactivée. Activez-la dans votre console Firebase." 
          : "Anonymous authentication is disabled. Enable it in your Firebase console.");
      } else {
        setAuthError(err.message);
      }
    } finally {
      setIsRetryingAuth(false);
    }
  };

  // Passive auto-retry when error is present
  useEffect(() => {
    if (authError && !isRetryingAuth) {
      const interval = setInterval(() => {
        console.log("Auth: Passive auto-retry...");
        signInAnonymously(getAuthInstance()).catch(() => {});
      }, 15000);
      return () => clearInterval(interval);
    }
  }, [authError, isRetryingAuth]);

  // Persist current conversation ID
  useEffect(() => {
    if (currentConversationId) {
      localStorage.setItem('cephboy-current-conv-id', currentConversationId);
    } else {
      localStorage.removeItem('cephboy-current-conv-id');
    }
  }, [currentConversationId]);

  // Keep local cache perfectly in sync with active conversation updates
  useEffect(() => {
    if (conversation) {
      saveConversationToLocalCache(conversation);
    }
  }, [conversation]);

  // User explicitly set language
  const handleLanguageChange = (newLang: Language | 'auto') => {
    if (newLang === 'auto') {
      localStorage.removeItem('app-language-override');
      localStorage.removeItem('app-language');
    } else {
      localStorage.setItem('app-language-override', newLang);
      localStorage.setItem('app-language', newLang);
      setLanguage(newLang as Language);
    }
    // Ensure state refreshes completely for translations and detection logic
    window.location.reload();
  };

  // Set initial sidebar state based on screen width
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setIsSidebarOpen(false);
      } else {
        setIsSidebarOpen(true);
      }
    };
    
    handleResize(); // Initial check
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 1. Fetch current conversation details when selection changes
  useEffect(() => {
    if (!currentConversationId) {
      setConversation(null);
      setCurrentProvider('');
      return;
    }

    const fetchConv = async () => {
      try {
        const docRef = doc(getDb(), 'conversations', currentConversationId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = { id: docSnap.id, ...docSnap.data() } as Conversation;
          setConversation(data);
          saveConversationToLocalCache(data); // Save/refresh cache
        } else {
          // Check cache anyway in case we are offline and couldn't fetch but have it locally
          const cached = getConversationFromLocalCache(currentConversationId);
          if (cached) {
            setConversation(cached);
          } else {
            // If conversation deleted or doesn't exist
            setCurrentConversationId(null);
          }
        }
      } catch (err: any) {
        console.warn("Error fetching conversation details from Firestore, trying cache:", err);
        const cached = getConversationFromLocalCache(currentConversationId);
        if (cached) {
          console.log("Loaded conversation from local cache fallback:", cached);
          setConversation(cached);
        } else if (err && err.code === 'permission-denied') {
          setCurrentConversationId(null);
        } else {
          // Avoid throwing fatal handles if it is just a connection/offline issue
          let errMsg = '';
          let errCode = '';
          if (err && typeof err === 'object') {
            errMsg = err.message || '';
            errCode = err.code || '';
          } else {
            errMsg = String(err);
          }
          const errStrLower = `${errMsg} ${errCode}`.toLowerCase();
          const isOfflineOrNetwork = 
            errStrLower.includes('offline') || 
            errStrLower.includes('unavailable') || 
            errStrLower.includes('could not reach') || 
            errStrLower.includes('network') ||
            errStrLower.includes('internet');

          if (isOfflineOrNetwork) {
            console.warn("Firestore is offline and no local cache was found for this ID.");
          } else {
            handleFirestoreError(err, OperationType.GET, `conversations/${currentConversationId}`);
          }
        }
      }
    };

    fetchConv();
  }, [currentConversationId]);

  // Create a brand new conversation in Firestore
  const handleCreateNewConversation = async () => {
    if (!userId) return;
    const newId = `chat_${Date.now()}`;
    const newChat: Conversation = {
      id: newId,
      userId: userId,
      title: "Nouvelle conversation",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: []
    };

    saveConversationToLocalCache(newChat);
    setCurrentConversationId(newId);
    setConversation(newChat);

    saveSafe(newId, newChat).catch((err) => {
      console.error("Failed to create new chat in Firestore:", err);
      handleFirestoreError(err, OperationType.CREATE, `conversations/${newId}`);
    });
  };

  // 2. Main message sender
  const handleSendMessage = async (content: string, searchWeb: boolean, sources: string[], imageEngine?: string, imageUrl?: string) => {
    let activeId = currentConversationId;
    
    // Create new conversation automatically if none is selected
    if (!activeId) {
      if (!userId) return;
      activeId = `chat_${Date.now()}`;
      const newChat: Conversation = {
        id: activeId,
        userId: userId,
        title: imageEngine 
            ? `Image: ${content.slice(0, 25)}...`
            : content.slice(0, 30) + (content.length > 30 ? "..." : ""),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: []
      };
      
      saveConversationToLocalCache(newChat);
      setCurrentConversationId(activeId);
      setConversation(newChat);
      
      saveSafe(activeId, newChat).catch((err) => {
        console.error("Failed to create auto chat in Firestore:", err);
        handleFirestoreError(err, OperationType.CREATE, `conversations/${activeId}`);
      });
    }

    if (imageEngine) {
      const userMsg: Message = {
        id: `msg_${Date.now()}_user`,
        role: 'user',
        content: `Générer une image : "${content}"`,
        timestamp: Date.now()
      };
      
      const currentMessages = conversation ? [...conversation.messages] : [];
      const updatedMessages = [...currentMessages, userMsg];
      
      const updatedConv: Conversation = {
        id: activeId,
        title: conversation?.title === "Nouvelle conversation" || !conversation 
          ? `Image: ${content.slice(0, 25)}...`
          : conversation.title,
        createdAt: conversation?.createdAt || Date.now(),
        updatedAt: Date.now(),
        messages: updatedMessages
      };
      
      setConversation(updatedConv);
      setIsGenerating(true);
      setCurrentProvider("Assistant");
      setCurrentStatusText("Création de l'image en cours...");
      
      saveSafe(activeId, updatedConv).catch(err => {
        console.error("Error saving user message (image):", err);
      });
      
      const assistantMsgId = `msg_${Date.now()}_assistant`;
      let generatedUrl = '';
      
      try {
        const response = await fetch('/api/generate-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: content, engine: imageEngine })
        });
        
        if (!response.ok) {
          let errorMessage = "Erreur lors de la génération de l'image.";
          try {
            const errData = await response.json();
            errorMessage = errData.error || errorMessage;
          } catch (e) {
            // Not JSON
          }
          throw new Error(errorMessage);
        }
        
        const data = await response.json();
        generatedUrl = data.imageUrl;
        const finalProvider = "Assistant";
        
        if (!generatedUrl) {
          throw new Error("Aucune image n'a pu être générée.");
        }
        
        // Finish image generation
        const finalMsg: Message = {
          id: assistantMsgId,
          role: 'assistant',
          content: `Voici l'image générée avec succès selon votre prompt : "${content}"`,
          timestamp: Date.now(),
          providerUsed: finalProvider,
          imageUrl: generatedUrl
        };
        
        const finalMessages = [...updatedMessages, finalMsg];
        const finalConv: Conversation = {
          ...updatedConv,
          userId: userId || undefined,
          messages: finalMessages,
          updatedAt: Date.now()
        };
        
        setConversation(finalConv);
        saveSafe(activeId, finalConv).catch(err => {
          console.error("Error saving final image conversation:", err);
        });
        
      } catch (err: any) {
        console.error("Image generation error:", err);
        const errMsg: Message = {
          id: assistantMsgId,
          role: 'assistant',
          content: `Échec de la génération de l'image : ${err.message || "Erreur inconnue."}`,
          timestamp: Date.now(),
          providerUsed: "Système Image"
        };
        
        const finalMessages = [...updatedMessages, errMsg];
        const finalConv: Conversation = {
          ...updatedConv,
          messages: finalMessages,
          updatedAt: Date.now()
        };
        setConversation(finalConv);
        saveSafe(activeId, finalConv).catch(err => {
          console.error("Error saving error image conversation:", err);
        });
      } finally {
        setIsGenerating(false);
        setCurrentStatusText('');
      }
      return;
    }

    const userMsg: Message = {
      id: `msg_${Date.now()}_user`,
      role: 'user',
      content,
      timestamp: Date.now(),
      ...(imageUrl && { imageUrl })
    };

    // Construct local updated messages list
    const currentMessages = conversation ? [...conversation.messages] : [];
    const updatedMessages = [...currentMessages, userMsg];

    // Optimistically update local view
    const updatedConv: Conversation = {
      id: activeId,
      userId: userId || undefined,
      title: conversation?.title === "Nouvelle conversation" || !conversation 
        ? content.slice(0, 35) + (content.length > 35 ? "..." : "") 
        : conversation.title,
      createdAt: conversation?.createdAt || Date.now(),
      updatedAt: Date.now(),
      messages: updatedMessages
    };
    
    setConversation(updatedConv);
    setIsGenerating(true);
    setCurrentProvider('');

    // Determine direct initial status text based on intent
    const statusLower = content.toLowerCase();
    let initialStatus = 'Réflexion en cours...';
    if (searchWeb) {
      if (statusLower.includes("musique") || statusLower.includes("chanson") || statusLower.includes("music") || statusLower.includes("song")) {
        initialStatus = 'Recherche de musique...';
      } else {
        initialStatus = 'Recherche sur le web...';
      }
    } else if (
      statusLower.includes("image") || 
      statusLower.includes("génère une image") || 
      statusLower.includes("crée une image") || 
      statusLower.includes("dessin") || 
      statusLower.includes("photo")
    ) {
      initialStatus = "Création de l'image...";
    } else if (
      statusLower.includes("analyse") || 
      statusLower.includes("pdf") || 
      statusLower.includes("fichier") || 
      statusLower.includes("document")
    ) {
      initialStatus = 'Analyse du document...';
    }

    setCurrentStatusText(initialStatus);

    // Save user message to Firestore non-blockingly
    saveSafe(activeId, updatedConv).catch(err => {
      console.error("Error saving user message to Firestore:", err);
      handleFirestoreError(err, OperationType.UPDATE, `conversations/${activeId}`);
    });

    const assistantMsgId = `msg_${Date.now()}_assistant`;
    let assistantCitations: Citation[] = [];
    let assistantImageUrl: string | undefined = undefined;

    // Now start the SSE call to Express backend
    const fetchWithRetry = async (retries = 3): Promise<Response> => {
      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages: updatedMessages,
            searchWeb,
            searchSources: linkedinSearch ? [...sources, 'linkedin'] : sources,
            selectedModel
          })
        });
        if (!response.ok) throw new Error(`Server error: ${response.status}`);
        return response;
      } catch (err) {
        if (retries > 0) {
          console.warn(`Chat request failed, retrying... (${retries} left)`);
          return await fetchWithRetry(retries - 1);
        }
        throw err;
      }
    };

    try {
      const response = await fetchWithRetry();
      
      if (!response.body) {
        throw new Error("Aucun flux de réponse reçu.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantContent = '';
      let detectedProvider = 'Assistant';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;

            try {
              const payload = JSON.parse(jsonStr);
              
              if (payload.type === 'status') {
                setCurrentStatusText(payload.message);
              } else if (payload.type === 'provider') {
                detectedProvider = payload.provider;
                setCurrentProvider(payload.provider);
              } else if (payload.type === 'media') {
                if (payload.imageUrl) {
                  assistantImageUrl = payload.imageUrl;
                  if (!assistantContent) assistantContent = `Voici l'image générée avec succès !`;
                }
              } else if (payload.type === 'citations') {
                assistantCitations = payload.citations;
              } else if (payload.type === 'content') {
                // Remove initial state status text once we get content
                setCurrentStatusText('');
                assistantContent += payload.content;

                // Dynamically display incremental text block
                setConversation(prev => {
                  if (!prev) return null;
                  
                  // Keep only one assistant message and update content
                  const cleanedMsgs = prev.messages.filter(m => m.id !== assistantMsgId);
                  const streamingMsg: Message = {
                    id: assistantMsgId,
                    role: 'assistant',
                    content: assistantContent,
                    timestamp: Date.now(),
                    citations: assistantCitations,
                    providerUsed: detectedProvider,
                    ...(assistantImageUrl && { imageUrl: assistantImageUrl }),
                    isStreaming: true
                  };

                  return {
                    ...prev,
                    messages: [...cleanedMsgs, streamingMsg]
                  };
                });
              } else if (payload.type === 'error') {
                assistantContent = payload.error;
                setCurrentStatusText('');
                setConversation(prev => {
                  if (!prev) return null;
                  const cleanedMsgs = prev.messages.filter(m => m.id !== assistantMsgId);
                  const errorMsg: Message = {
                    id: assistantMsgId,
                    role: 'assistant',
                    content: assistantContent,
                    timestamp: Date.now(),
                    citations: assistantCitations,
                    providerUsed: detectedProvider
                  };
                  return {
                    ...prev,
                    messages: [...cleanedMsgs, errorMsg]
                  };
                });
              }
            } catch (err) {
              // Ignore partial JSON parse errors
            }
          }
        }
      }

      // Finish streaming and finalize conversation structure
      reader.releaseLock();
      
      const finalAssistantMsg: Message = {
        id: assistantMsgId,
        role: 'assistant',
        content: assistantContent || "Désolé, je n'ai pas pu générer de réponse.",
        timestamp: Date.now(),
        citations: assistantCitations,
        ...(assistantImageUrl && { imageUrl: assistantImageUrl }),
        providerUsed: detectedProvider
      };

      const finalMessages = [...updatedMessages, finalAssistantMsg];
      const finalConv: Conversation = {
        ...updatedConv,
        messages: finalMessages,
        updatedAt: Date.now()
      };

      setConversation(finalConv);
      
      // Persist finished state to Firestore non-blockingly
      saveSafe(activeId, finalConv).catch(err => {
        console.error("Error persisting final conversation state to Firestore:", err);
        handleFirestoreError(err, OperationType.UPDATE, `conversations/${activeId}`);
      });

    } catch (err: any) {
      console.error("SSE Chat Error:", err);
      
      const errorMsg: Message = {
        id: `msg_${Date.now()}_err`,
        role: 'assistant',
        content: `Une erreur est survenue : ${err.message || "Impossible de joindre les serveurs."}`,
        timestamp: Date.now(),
        providerUsed: "Système"
      };

      setConversation(prev => {
        if (!prev) return null;
        return {
          ...prev,
          messages: [...prev.messages.filter(m => !m.isStreaming), errorMsg]
        };
      });
    } finally {
      setIsGenerating(false);
      setCurrentStatusText('');
    }
  };

  const handleSelectConversation = (id: string) => {
    setCurrentConversationId(id);
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  const handleUploadFile = async (file: File, userPrompt?: string) => {
    // Special check for logo update
    // If the file name contains 'logo' and it's an image, we treat it as a logo update
    const isLogoUpdate = file.name.toLowerCase().includes('logo') && file.type.startsWith('image/');

    if (isLogoUpdate) {
      setIsGenerating(true);
      setCurrentStatusText("Mise à jour du logo de l'application...");
      try {
        const formData = new FormData();
        formData.append('logo', file);
        const res = await fetch('/api/save-logo', {
          method: 'POST',
          body: formData
        });
        if (res.ok) {
          const data = await res.json();
          alert("Logo de l'application mis à jour avec succès ! Veuillez rafraîchir la page si nécessaire.");
          return; // Stop here, don't send as chat message
        } else {
          const errData = await res.json();
          throw new Error(errData.error || "Erreur serveur");
        }
      } catch (err: any) {
        console.error("Logo upload error:", err);
        alert("Erreur lors de la mise à jour du logo : " + err.message);
      } finally {
        setIsGenerating(false);
        setCurrentStatusText('');
      }
    }

    let activeId = currentConversationId;
    if (!activeId) {
      activeId = `chat_${Date.now()}`;
      const newChat: Conversation = {
        id: activeId,
        title: file.name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: []
      };
      saveConversationToLocalCache(newChat);
      setConversation(newChat);
      setCurrentConversationId(activeId);
      saveSafe(activeId, newChat).catch((err) => {
        console.error("Failed to create auto chat for file upload:", err);
      });
    }

    if (file.type.startsWith('image/')) {
      return handleUploadImage(file, userPrompt);
    }

    // Handle documents
    setIsGenerating(true);
    setCurrentStatusText("Analyse du document en cours...");
    
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/parse-file', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) throw new Error("Erreur lors de l'analyse du fichier.");

      const data = await response.json();
      
      const userMsg: Message = {
        id: `msg_${Date.now()}_user`,
        role: 'user',
        content: `Document uploadé : ${file.name}\n\n[CONTENU DU FICHIER ANALYSÉ]\n${data.content.slice(0, 10000)}${data.content.length > 10000 ? '... (tronqué)' : ''}`,
        timestamp: Date.now()
      };

      const currentMessages = conversation ? [...conversation.messages] : [];
      const updatedMessages = [...currentMessages, userMsg];
      
      const updatedConv: Conversation = {
        id: activeId,
        title: (!conversation || conversation.title === "Nouvelle conversation") ? file.name : conversation.title,
        createdAt: conversation?.createdAt || Date.now(),
        updatedAt: Date.now(),
        messages: updatedMessages
      };

      setConversation(updatedConv);
      saveSafe(activeId, updatedConv).catch((err) => {
        console.error("Failed to save parsed document to Firestore:", err);
      });

      // Automatically ask AI to analyze
      handleSendMessage(userPrompt || `J'ai téléchargé un fichier nommé "${file.name}". Peux-tu l'analyser et m'en faire un résumé ou répondre à mes questions à son sujet ?`, false, ['duckduckgo', 'wikipedia']);

    } catch (err: any) {
      console.error("File upload error:", err);
      alert("Erreur lors du téléchargement du fichier: " + err.message);
    } finally {
      setIsGenerating(false);
      setCurrentStatusText('');
    }
  };

  const handleUploadImage = async (file: File, userPrompt?: string) => {
    let activeId = currentConversationId;
    if (!activeId) {
      activeId = `chat_${Date.now()}`;
      const newChat: Conversation = {
        id: activeId,
        title: "Image Uploadée",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: []
      };
      saveConversationToLocalCache(newChat);
      setConversation(newChat);
      setCurrentConversationId(activeId);
      saveSafe(activeId, newChat).catch((err) => {
        console.error("Failed to create auto chat for image upload:", err);
      });
    }

    try {
      const base64 = await fileToBase64(file);
      const userMsg: Message = {
        id: `msg_${Date.now()}_user`,
        role: 'user',
        content: userPrompt || `Image uploadée : ${file.name}`,
        timestamp: Date.now(),
        imageUrl: base64
      };

      const currentMessages = conversation ? [...conversation.messages] : [];
      const updatedMessages = [...currentMessages, userMsg];
      const updatedConv = { 
        ...conversation, 
        id: activeId,
        messages: updatedMessages, 
        updatedAt: Date.now(),
        title: (!conversation || conversation.title === "Nouvelle conversation") ? "Image Uploadée" : conversation.title
      } as Conversation;

      setConversation(updatedConv);
      saveSafe(activeId, updatedConv).catch((err) => {
        console.error("Failed to save uploaded image to Firestore:", err);
      });
      
      // Automatically trigger analysis for image
      handleSendMessage(userPrompt || `J'ai téléchargé une image nommée "${file.name}". Peux-tu l'analyser et me dire ce que tu y vois ?`, false, [], undefined, base64);
    } catch (err) {
      console.error("Upload error:", err);
      alert("Erreur lors de l'upload de l'image.");
    }
  };

  return (
    <div className="flex h-screen h-[100dvh] w-screen bg-[#0d0d0d] overflow-hidden font-sans antialiased text-zinc-100">
      <Sidebar
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onCreateNewConversation={handleCreateNewConversation}
        isOpen={isSidebarOpen}
        setIsOpen={setIsSidebarOpen}
        language={language}
        onLanguageChange={handleLanguageChange}
        userId={userId}
        authError={!!authError}
      />
      <div className="flex-1 flex flex-col min-w-0 bg-[#09090b] relative">
        {authError && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[100] w-[95%] max-w-2xl bg-slate-950/95 border-2 border-orange-500/50 backdrop-blur-3xl rounded-3xl p-6 flex flex-col items-stretch gap-6 shadow-[0_0_100px_-12px_rgba(249,115,22,0.5)] animate-in fade-in zoom-in-95 duration-300">
            <div className="flex items-start gap-6">
              <div className="bg-orange-500 p-4 rounded-2xl shadow-2xl shadow-orange-500/40 shrink-0">
                <Cpu className="w-8 h-8 text-white animate-pulse" />
              </div>
              <div className="space-y-3 flex-1">
                <p className="text-lg font-bold text-orange-200 tracking-tight">Configuration Firebase Requise</p>
                <div className="space-y-3 text-sm text-orange-100/80 leading-relaxed">
                  <p className="font-medium">L'authentification anonyme est actuellement <span className="text-orange-400 font-bold uppercase underline">désactivée</span> dans votre projet.</p>
                  <div className="bg-orange-500/10 border border-orange-500/20 p-4 rounded-2xl space-y-2 shadow-inner">
                    <p className="font-bold text-orange-300 flex items-center gap-2">
                      <Check className="w-4 h-4" /> Solution immédiate :
                    </p>
                    <ol className="list-decimal list-inside space-y-1.5 ml-1 opacity-90 font-medium">
                      <li>Ouvrez la <strong>Console Firebase</strong></li>
                      <li>Allez dans l'onglet <strong className="text-orange-300 underline">Authentification</strong> (pas Firestore)</li>
                      <li>Cliquez sur <strong>Sign-in method</strong></li>
                      <li>Activez le fournisseur <strong className="text-orange-300 underline">Anonyme</strong></li>
                    </ol>
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 pt-2">
                   <a 
                    href={`https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/providers`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-orange-400 hover:text-orange-300 underline font-semibold flex items-center gap-1.5 py-1"
                   >
                     <ExternalLink className="w-4 h-4" /> Accès direct Authentification
                   </a>
                </div>
              </div>
              <button onClick={() => setAuthError(null)} className="p-2 hover:bg-white/10 rounded-2xl text-slate-500 transition-colors cursor-pointer shrink-0">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="space-y-4">
              <button 
                onClick={() => performAuthRetry()} 
                disabled={isRetryingAuth}
                className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white py-4 rounded-2xl text-base font-black transition-all shadow-xl shadow-orange-600/30 flex items-center justify-center gap-3 cursor-pointer transform active:scale-95"
              >
                {isRetryingAuth ? (
                  <>
                    <Activity className="w-5 h-5 animate-spin" />
                    Tentative de reconnexion...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-5 h-5" />
                    Réessayer la synchronisation
                  </>
                )}
              </button>

              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => setAuthError(null)} 
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer border border-white/5"
                >
                  Continuer en local
                </button>
                <button 
                  onClick={() => window.location.reload()} 
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer border border-white/5"
                >
                  Actualiser
                </button>
              </div>
            </div>
            
            {authErrorCode && (
              <div className="pt-4 border-t border-white/5 flex flex-col items-center">
                <span className="text-[10px] text-slate-500 uppercase tracking-widest font-mono">Code d'erreur</span>
                <span className="text-xs text-orange-400 font-mono mt-1 font-bold">{authErrorCode}</span>
              </div>
            )}
          </div>
        )}
        <ChatArea
        conversation={conversation}
        onSendMessage={handleSendMessage}
        onUploadFile={handleUploadFile}
        onUploadAndRemoveBg={() => {}}
        isGenerating={isGenerating}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        isSidebarOpen={isSidebarOpen}
        currentProvider={currentProvider}
        currentStatusText={currentStatusText}
        language={language}
        searchWeb={searchWeb}
        setSearchWeb={setSearchWeb}
        isImageMode={isImageMode}
        setIsImageMode={setIsImageMode}
        imageEngine={imageEngine}
        setImageEngine={setImageEngine}
        linkedinSearch={linkedinSearch}
        onNewConversation={handleCreateNewConversation}
        selectedModel={selectedModel}
        onSelectedModelChange={handleSetSelectedModel}
      />
      </div>
    </div>
  );
}
