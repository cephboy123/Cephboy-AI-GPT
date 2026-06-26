import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import SettingsModal from './components/SettingsModal';
import { translations, Language } from './translations';
import { Conversation, Message, Citation } from './components/types';
import { 
  db, 
  collection, 
  doc, 
  setDoc, 
  getDoc,
  deleteDoc,
  handleFirestoreError,
  OperationType
} from './components/firebase';

export default function App() {
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentProvider, setCurrentProvider] = useState<string>('');
  const [currentStatusText, setCurrentStatusText] = useState<string>('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [searchWeb, setSearchWeb] = useState(false);
  const [linkedinSearch, setLinkedinSearch] = useState(false);
  const [isImageMode, setIsImageMode] = useState(false);
  const [imageEngine, setImageEngine] = useState<'pollinations' | 'gemini' | 'pixelapi'>('pollinations');
  const [logoVersion, setLogoVersion] = useState(Date.now());
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem('app-language');
    return (saved as Language) || 'fr';
  });

  const t = translations[language];

  // Persist language
  useEffect(() => {
    localStorage.setItem('app-language', language);
  }, [language]);

  const handleLanguageChange = (newLang: Language) => {
    localStorage.setItem('app-language', newLang);
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
        const docRef = doc(db, 'conversations', currentConversationId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setConversation({ id: docSnap.id, ...docSnap.data() } as Conversation);
        } else {
          // If conversation deleted or doesn't exist
          setCurrentConversationId(null);
        }
      } catch (err) {
        console.error("Error fetching conversation details:", err);
        handleFirestoreError(err, OperationType.GET, `conversations/${currentConversationId}`);
      }
    };

    fetchConv();
  }, [currentConversationId]);

  // Create a brand new conversation in Firestore
  const handleCreateNewConversation = async () => {
    const newId = `chat_${Date.now()}`;
    const newChat: Conversation = {
      id: newId,
      title: "Nouvelle conversation",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: []
    };

    try {
      await setDoc(doc(db, 'conversations', newId), newChat);
      setCurrentConversationId(newId);
    } catch (err) {
      console.error("Failed to create new chat in Firestore:", err);
      handleFirestoreError(err, OperationType.CREATE, `conversations/${newId}`);
    }
  };

  // 2. Main message sender
  const handleSendMessage = async (content: string, searchWeb: boolean, sources: string[], imageEngine?: string) => {
    let activeId = currentConversationId;
    
    // Create new conversation automatically if none is selected
    if (!activeId) {
      activeId = `chat_${Date.now()}`;
      const newChat: Conversation = {
        id: activeId,
        title: imageEngine 
          ? `Image: ${content.slice(0, 25)}...`
          : content.slice(0, 30) + (content.length > 30 ? "..." : ""),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: []
      };
      try {
        await setDoc(doc(db, 'conversations', activeId), newChat);
        setCurrentConversationId(activeId);
      } catch (err) {
        console.error("Failed to create auto chat in Firestore:", err);
        handleFirestoreError(err, OperationType.CREATE, `conversations/${activeId}`);
        return;
      }
    }

    if (imageEngine) {
      const userMsg: Message = {
        id: `msg_${Date.now()}_user`,
        role: 'user',
        content: `Générer une image : "${content}" (${imageEngine === 'gemini' ? 'Gemini AI' : 'Pollinations AI'})`,
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
      setCurrentProvider(imageEngine === 'gemini' ? 'Gemini AI' : 'Pollinations AI');
      setCurrentStatusText("Création de l'image en cours...");
      
      try {
        await setDoc(doc(db, 'conversations', activeId), updatedConv);
      } catch (err) {
        console.error("Error saving user message:", err);
      }
      
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
        const finalProvider = data.provider || (imageEngine === 'gemini' ? 'Gemini AI' : 'Pollinations AI');
        
        if (!generatedUrl) {
          throw new Error("Aucune image n'a pu être générée.");
        }
        
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
          messages: finalMessages,
          updatedAt: Date.now()
        };
        
        setConversation(finalConv);
        await setDoc(doc(db, 'conversations', activeId), finalConv);
        
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
        await setDoc(doc(db, 'conversations', activeId), finalConv);
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
      timestamp: Date.now()
    };

    // Construct local updated messages list
    const currentMessages = conversation ? [...conversation.messages] : [];
    const updatedMessages = [...currentMessages, userMsg];

    // Optimistically update local view
    const updatedConv: Conversation = {
      id: activeId,
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
    setCurrentStatusText('Initialisation de Cephboy...');

    // Save user message to Firestore immediately
    try {
      await setDoc(doc(db, 'conversations', activeId), updatedConv);
    } catch (err) {
      console.error("Error saving user message to Firestore:", err);
      handleFirestoreError(err, OperationType.UPDATE, `conversations/${activeId}`);
    }

    const assistantMsgId = `msg_${Date.now()}_assistant`;
    let assistantCitations: Citation[] = [];

    // Now start the SSE call to Express backend
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: updatedMessages,
          searchWeb,
          searchSources: linkedinSearch ? [...sources, 'linkedin'] : sources
        })
      });

      if (!response.ok) {
        let errorMessage = "Erreur de connexion avec le serveur.";
        try {
          const errData = await response.json();
          errorMessage = errData.error || errorMessage;
        } catch (e) {
          // Not JSON
        }
        throw new Error(errorMessage);
      }

      if (!response.body) {
        throw new Error("Aucun flux de réponse reçu.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantContent = '';
      let detectedProvider = 'Cephboy AI GPT';

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
              }
            } catch (err) {
              // Ignore partial JSON parse errors
            }
          }
        }
      }

      // Finish streaming and finalize conversation structure
      const finalAssistantMsg: Message = {
        id: assistantMsgId,
        role: 'assistant',
        content: assistantContent || "Désolé, je n'ai pas pu générer de réponse.",
        timestamp: Date.now(),
        citations: assistantCitations,
        providerUsed: detectedProvider
      };

      const finalMessages = [...updatedMessages, finalAssistantMsg];
      const finalConv: Conversation = {
        ...updatedConv,
        messages: finalMessages,
        updatedAt: Date.now()
      };

      setConversation(finalConv);
      
      // Persist finished state to Firestore
      try {
        await setDoc(doc(db, 'conversations', activeId), finalConv);
      } catch (err) {
        console.error("Error persisting final conversation state to Firestore:", err);
        handleFirestoreError(err, OperationType.UPDATE, `conversations/${activeId}`);
      }

    } catch (err: any) {
      console.error("SSE Chat Error:", err);
      
      const errorMsg: Message = {
        id: `msg_${Date.now()}_err`,
        role: 'assistant',
        content: `Une erreur est survenue : ${err.message || "Impossible de joindre les serveurs Cephboy AI GPT."}`,
        timestamp: Date.now(),
        providerUsed: "Système Cephboy"
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

  const handleUploadFile = async (file: File) => {
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
          setLogoVersion(Date.now());
          alert("Logo de l'application mis à jour avec succès !");
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
      await setDoc(doc(db, 'conversations', activeId), newChat);
      setCurrentConversationId(activeId);
    }

    if (file.type.startsWith('image/')) {
      return handleUploadImage(file);
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
      await setDoc(doc(db, 'conversations', activeId), updatedConv);

      // Automatically ask AI to analyze
      handleSendMessage(`J'ai téléchargé un fichier nommé "${file.name}". Peux-tu l'analyser et m'en faire un résumé ou répondre à mes questions à son sujet ?`, false, ['duckduckgo', 'wikipedia']);

    } catch (err: any) {
      console.error("File upload error:", err);
      alert("Erreur lors du téléchargement du fichier: " + err.message);
    } finally {
      setIsGenerating(false);
      setCurrentStatusText('');
    }
  };

  const handleUploadImage = async (file: File) => {
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
      await setDoc(doc(db, 'conversations', activeId), newChat);
      setCurrentConversationId(activeId);
    }

    try {
      const base64 = await fileToBase64(file);
      const userMsg: Message = {
        id: `msg_${Date.now()}_user`,
        role: 'user',
        content: `Image uploadée : ${file.name}`,
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
      await setDoc(doc(db, 'conversations', activeId), updatedConv);
      
      // Automatically trigger analysis for image
      handleSendMessage(`J'ai téléchargé une image nommée "${file.name}". Peux-tu l'analyser et me dire ce que tu y vois ?`, false, []);
    } catch (err) {
      console.error("Upload error:", err);
      alert("Erreur lors de l'upload de l'image.");
    }
  };

  return (
    <div className="flex h-screen bg-[#0d0d0d] overflow-hidden font-sans antialiased text-gray-200">
      <Sidebar
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onCreateNewConversation={handleCreateNewConversation}
        isOpen={isSidebarOpen}
        setIsOpen={setIsSidebarOpen}
        language={language}
        onLanguageChange={handleLanguageChange}
        onOpenSettings={() => setIsSettingsOpen(true)}
        logoVersion={logoVersion}
      />
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
        logoVersion={logoVersion}
      />
      {isSettingsOpen && (
        <SettingsModal 
          isOpen={isSettingsOpen} 
          onClose={() => setIsSettingsOpen(false)}
          language={language}
          onLanguageChange={handleLanguageChange}
          searchWeb={searchWeb}
          setSearchWeb={setSearchWeb}
          isImageMode={isImageMode}
          setIsImageMode={setIsImageMode}
          imageEngine={imageEngine}
          setImageEngine={setImageEngine}
          linkedinSearch={linkedinSearch}
          setLinkedinSearch={setLinkedinSearch}
        />
      )}
    </div>
  );
}
