import React, { useState, useRef, useEffect } from 'react';
import Markdown from 'react-markdown';
import { jsPDF } from 'jspdf';
import { 
  Message, 
  Citation, 
  Conversation 
} from './types';
import { translations, Language } from '../translations';
import MusicPlayer from './MusicPlayer';
import VideoPlayer from './VideoPlayer';
import { 
  Send, 
  Bot, 
  User, 
  Search, 
  Globe, 
  Menu, 
  Check, 
  Copy, 
  Sparkles, 
  ChevronDown, 
  Cpu, 
  Download,
  Maximize,
  Image,
  Music,
  Github, 
  BookOpen, 
  TrendingUp, 
  Hash, 
  Compass, 
  ExternalLink,
  RotateCcw,
  Loader2,
  FileText,
  Paperclip,
  X,
  Plus,
  ThumbsUp,
  ThumbsDown,
  AlertTriangle,
  ArrowUp,
  Sliders,
  Volume2,
  VolumeX,
  MessageSquare
} from 'lucide-react';

const AI_LOGO_URL = "/logo.png";

const downloadImage = (url: string, name: string = 'cephboy_image') => {
  if (!url) return;
  const a = document.createElement('a');
  a.href = `/api/download-image?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(name)}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

function StreamingMarkdown({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  const [displayedContent, setDisplayedContent] = React.useState(isStreaming ? "" : content);
  const [isTyping, setIsTyping] = React.useState(isStreaming);
  const typingTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    if (!isStreaming) {
      setDisplayedContent(content);
      setIsTyping(false);
      return;
    }

    if (displayedContent.length < content.length) {
      setIsTyping(true);
      // Realistic typing speed: faster for catch-up, but still "one by one"
      const diff = content.length - displayedContent.length;
      const delay = diff > 50 ? 2 : diff > 20 ? 8 : 25;
      
      typingTimerRef.current = setTimeout(() => {
        setDisplayedContent(content.substring(0, displayedContent.length + 1));
      }, delay);
    } else {
      setIsTyping(false);
    }

    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, [content, displayedContent, isStreaming]);

  return (
    <Markdown
      components={{
        img: ({ src, alt }) => (
          <div className="relative group/img my-3">
            <img src={src || null} alt={alt} className="rounded-xl border border-zinc-800 max-h-[400px] object-contain mx-auto shadow-sm" />
            <button
              onClick={() => downloadImage(src || '', 'cephboy_markdown_image')}
              className="absolute top-2 right-2 p-1.5 bg-zinc-900/90 backdrop-blur-xs rounded-lg text-zinc-300 opacity-0 group-hover/img:opacity-100 transition-opacity hover:bg-orange-600 hover:text-white shadow-md cursor-pointer"
              title="Télécharger l'image"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          </div>
        ),
        p: ({ children }) => <div className="leading-relaxed mb-3 text-zinc-300 last:mb-0 text-[15px] sm:text-[16.5px]">{children}</div>,
        h1: ({ children }) => <h1 className="text-base font-extrabold mt-4 mb-2 text-zinc-100 border-b border-zinc-850 pb-1 uppercase tracking-wider">{children}</h1>,
        h2: ({ children }) => <h2 className="text-sm font-bold mt-3 mb-1.5 text-zinc-100">{children}</h2>,
        h3: ({ children }) => <h3 className="text-xs font-semibold mt-2.5 mb-1 text-zinc-200 uppercase tracking-wide">{children}</h3>,
        ul: ({ children }) => <ul className="list-disc pl-4 mb-3 space-y-1 text-zinc-400 text-[15px] sm:text-[16.5px]">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 mb-3 space-y-1 text-zinc-400 text-[15px] sm:text-[16.5px]">{children}</ol>,
        li: ({ children }) => <li className="text-zinc-300 text-[15px] sm:text-[16.5px]">{children}</li>,
        code: ({ node, className, children, ...props }: any) => {
          if (className === 'language-music-player') {
            const contentStr = String(children);
            const lines = contentStr.split('\n');
            const meta: any = {};
            lines.forEach(line => {
              const idx = line.indexOf(':');
              if (idx !== -1) {
                const key = line.slice(0, idx).trim().toLowerCase();
                const value = line.slice(idx + 1).trim();
                meta[key] = value;
              }
            });
            return (
              <MusicPlayer
                title={meta.title || 'Musique libre de droits'}
                artist={meta.artist || 'Artiste'}
                cover={meta.cover || null}
                duration={parseInt(meta.duration, 10) || 0}
                audioUrl={meta.audio || null}
              />
            );
          }
          if (className === 'language-video-player') {
            const contentStr = String(children);
            const lines = contentStr.split('\n');
            const meta: any = {};
            lines.forEach(line => {
              const idx = line.indexOf(':');
              if (idx !== -1) {
                const key = line.slice(0, idx).trim().toLowerCase();
                const value = line.slice(idx + 1).trim();
                meta[key] = value;
              }
            });
            return (
              <VideoPlayer
                title={meta.title || 'Vidéo libre de droits'}
                thumbnail={meta.thumbnail}
                videoUrl={meta.video}
                duration={parseInt(meta.duration, 10) || 0}
                source={meta.source}
                downloadUrl={meta.video}
              />
            );
          }
          const isBlock = !/inline/.test(className || '');
          return isBlock ? (
            <pre className="bg-zinc-950 text-amber-100 p-3 rounded-xl overflow-x-auto my-2 text-[11px] font-mono border border-zinc-900 leading-normal shadow-md">
              <code className={className} {...props}>
                {children}
              </code>
            </pre>
          ) : (
            <code className="bg-zinc-900 text-orange-400 px-1.5 py-0.5 rounded text-[11px] font-mono border border-zinc-850" {...props}>
              {children}
            </code>
          );
        },
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:text-orange-400 underline font-semibold inline-flex items-center gap-0.5">
            {children} <ExternalLink className="w-3 h-3 inline" />
          </a>
        ),
        blockquote: ({ children }) => <blockquote className="border-l-4 border-orange-500 pl-4 italic my-3 text-zinc-400 bg-zinc-900/50 py-1.5 pr-2 rounded-r-lg">{children}</blockquote>,
      }}
    >
      {displayedContent}
    </Markdown>
  );
}

interface ChatAreaProps {
  conversation: Conversation | null;
  onSendMessage: (content: string, searchWeb: boolean, sources: string[], imageEngine?: string) => void;
  onUploadFile: (file: File, userPrompt?: string) => void;
  onUploadAndRemoveBg: (file: File) => void;
  isGenerating: boolean;
  onToggleSidebar: () => void;
  isSidebarOpen: boolean;
  currentProvider?: string;
  currentStatusText?: string;
  language: Language;
  searchWeb: boolean;
  setSearchWeb: (val: boolean) => void;
  isImageMode: boolean;
  setIsImageMode: (val: boolean) => void;
  imageEngine: 'pollinations' | 'gemini' | 'pixelapi' | 'cloudflare';
  setImageEngine: (val: 'pollinations' | 'gemini' | 'pixelapi' | 'cloudflare') => void;
  linkedinSearch: boolean;
  onNewConversation?: () => void;
  selectedModel?: 'cephgpt1' | 'cephgpt2' | 'duo';
  onSelectedModelChange?: (val: 'cephgpt1' | 'cephgpt2' | 'duo') => void;
}

export default function ChatArea({
  conversation,
  onSendMessage,
  onUploadFile,
  onUploadAndRemoveBg,
  isGenerating,
  onToggleSidebar,
  isSidebarOpen,
  currentProvider,
  currentStatusText,
  language,
  searchWeb,
  setSearchWeb,
  isImageMode,
  setIsImageMode,
  imageEngine,
  setImageEngine,
  linkedinSearch,
  onNewConversation,
  selectedModel = 'duo',
  onSelectedModelChange
}: ChatAreaProps) {
  const [inputValue, setInputValue] = useState('');
  const [showInputParams, setShowInputParams] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFilePreview, setSelectedFilePreview] = useState<string | null>(null);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [audioLoadingId, setAudioLoadingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const t = translations[language];

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto scroll to bottom
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior
      });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior });
    }
  };

  const lastMessageContent = conversation?.messages && conversation.messages.length > 0 
    ? conversation.messages[conversation.messages.length - 1].content 
    : '';

  useEffect(() => {
    scrollToBottom('smooth');
    // Set a tiny timeout to scroll again once layouts/images are loaded or state is committed
    const timer = setTimeout(() => {
      scrollToBottom('auto');
    }, 100);
    return () => clearTimeout(timer);
  }, [conversation?.messages?.length, lastMessageContent, isGenerating, currentStatusText]);

  const cleanTextForTTS = (mdText: string): string => {
    if (!mdText) return "";
    let text = mdText;
    
    // Remove code blocks
    text = text.replace(/```[\s\S]*?```/g, "");
    
    // Remove LaTeX math
    text = text.replace(/\$\$[\s\S]*?\$\$/g, "");
    text = text.replace(/\$[^$]*?\$/g, "");
    
    // Remove inline code but keep content
    text = text.replace(/`([^`]+)`/g, "$1");
    
    // Remove bold/italic markdown but keep content
    text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
    text = text.replace(/\*([^*]+)\*/g, "$1");
    text = text.replace(/__([^_]+)__/g, "$1");
    text = text.replace(/_([^_]+)_/g, "$1");

    // Remove images
    text = text.replace(/!\[([^\]]*)\]\([^\)]+\)/g, "");
    
    // Keep link text
    text = text.replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1");
    
    // Remove header symbols but keep text
    text = text.replace(/^#+\s+/gm, "");
    
    // Remove list markers but keep text
    text = text.replace(/^[\s*-+>]+\s+/gm, "");
    text = text.replace(/^\d+\.\s+/gm, "");

    // Remove image placeholders and UI markers
    text = text.replace(/\[Image:.*?\]/g, "");
    text = text.replace(/!\[.*?\]/g, "");
    
    // Remove URLs
    text = text.replace(/https?:\/\/\S+/g, "");

    // Replace newlines with spaces for smoother speech
    text = text.replace(/\n+/g, " ");
    
    // Remove remaining emojis and special symbols that sound robotic
    text = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/gu, '');
    text = text.replace(/[|\\/~^=<>]/g, " ");

    // Final trim and limit
    // Bark works best with shorter segments
    if (text.length > 400) {
      text = text.substring(0, 400) + "...";
    }

    return text.trim();
  };

  const ttsPlayPromiseRef = useRef<Promise<void> | null>(null);

  const handlePlayTTS = async (message: Message) => {
    if (playingMessageId === message.id) {
      if (audioRef.current) {
        try {
          if (ttsPlayPromiseRef.current) {
            await ttsPlayPromiseRef.current;
          }
          audioRef.current.pause();
        } catch (e) {}
        audioRef.current = null;
      }
      setPlayingMessageId(null);
      return;
    }

    if (audioRef.current) {
      try {
        if (ttsPlayPromiseRef.current) {
          await ttsPlayPromiseRef.current;
        }
        audioRef.current.pause();
      } catch (e) {
        // Ignore errors from pausing an audio that hasn't started yet
      }
      audioRef.current = null;
    }

    setAudioLoadingId(message.id);
    try {
      const cleanText = cleanTextForTTS(message.content);
      if (!cleanText) {
        setAudioLoadingId(null);
        return;
      }
      
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleanText, voice: "Kore" }),
      });
      
      if (!response.ok) throw new Error("TTS request failed");
      
      const data = await response.json();
      
      // Use Blob instead of data URI for more reliability and debugging
      const binaryString = atob(data.audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'audio/wav' });
      const audioUrl = URL.createObjectURL(blob);
      
      audioRef.current = new Audio(audioUrl);
      audioRef.current.onerror = () => {
        setPlayingMessageId(null);
        setAudioLoadingId(null);
        console.error("TTS Audio playback error");
      };
      audioRef.current.onended = () => {
        setPlayingMessageId(null);
        URL.revokeObjectURL(audioUrl);
      };
      
      try {
        const playPromise = audioRef.current.play();
        ttsPlayPromiseRef.current = playPromise;
        await playPromise;
        ttsPlayPromiseRef.current = null;
        setPlayingMessageId(message.id);
      } catch (playErr: any) {
        ttsPlayPromiseRef.current = null;
        if (playErr.name !== 'AbortError') {
          console.error("TTS Audio playback failed:", playErr.message || playErr);
        }
      }
      setAudioLoadingId(null);
    } catch (err) {
      console.error("TTS error:", err);
      setAudioLoadingId(null);
      setPlayingMessageId(null);
    }
  };

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const downloadAsTxt = (message: Message) => {
    const element = document.createElement("a");
    const file = new Blob([message.content], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `cephboy_export_${Date.now()}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const generatePDF = (message: Message) => {
    const doc = new jsPDF();
    const margin = 15;
    const pageWidth = doc.internal.pageSize.getWidth();
    const maxWidth = pageWidth - (margin * 2);
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Cephboy AI GPT - Export", margin, 20);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Généré le : ${new Date().toLocaleString()}`, margin, 28);
    
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, 32, pageWidth - margin, 32);
    
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    
    const lines = doc.splitTextToSize(message.content, maxWidth);
    let cursorY = 40;
    
    lines.forEach((line: string) => {
      if (cursorY > 280) {
        doc.addPage();
        cursorY = 20;
      }
      doc.text(line, margin, cursorY);
      cursorY += 7;
    });
    
    doc.save(`cephboy_export_${Date.now()}.pdf`);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setSelectedFilePreview(reader.result as string);
        };
        reader.readAsDataURL(file);
      } else {
        setSelectedFilePreview(null);
      }
    }
    // Reset input
    e.target.value = '';
  };

  const handleCancelFile = () => {
    setSelectedFile(null);
    setSelectedFilePreview(null);
  };

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'github': return <Github className="w-3.5 h-3.5 text-slate-400" />;
      case 'wikipedia': return <BookOpen className="w-3.5 h-3.5 text-sky-400" />;
      case 'hackernews': return <Hash className="w-3.5 h-3.5 text-orange-400" />;
      case 'reddit': return <TrendingUp className="w-3.5 h-3.5 text-rose-400" />;
      default: return <Globe className="w-3.5 h-3.5 text-amber-400" />;
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0a0a0a] text-zinc-100 font-sans relative overflow-hidden">
      
      {/* Top navbar in Google AI Studio style */}
      <header className="flex items-center justify-between px-6 py-4.5 border-b border-zinc-900 bg-[#0c0c0e]/95 backdrop-blur-md z-10 sticky top-0 shadow-xs">
        <div className="flex items-center gap-3">
          {!isSidebarOpen && (
            <button 
              onClick={onToggleSidebar}
              className="p-2 hover:bg-zinc-850 rounded-lg cursor-pointer transition-colors"
              title={t.openMenu}
            >
              <Menu className="w-5 h-5 text-zinc-300" />
            </button>
          )}
          <div className="flex items-center gap-2.5">
            <img 
              src="/logo.png" 
              alt="Logo" 
              className="w-5 h-5 object-cover rounded-md"
              onError={(e) => {
                (e.target as HTMLImageElement).src = 'https://api.dicebear.com/7.x/bottts/svg?seed=Cephboy&backgroundColor=ea580c';
              }}
            />
            <div className="flex flex-col">
              <span className="font-bold text-base text-zinc-100 tracking-tight">{t.appName}</span>
            </div>
          </div>
        </div>

        {onNewConversation && (
          <button
            onClick={onNewConversation}
            className="p-2 hover:bg-zinc-850 rounded-full text-zinc-300 hover:text-white transition-colors cursor-pointer"
            title="Nouvelle conversation"
          >
            <Plus className="w-5 h-5" />
          </button>
        )}
      </header>

      {/* Messages area */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 md:px-8 lg:px-12 xl:px-16 py-8 space-y-6 bg-[#0d0d0d]">
        {(!conversation || conversation.messages.length === 0) ? (
          <div className="h-full flex flex-col items-center justify-center max-w-2xl mx-auto text-center space-y-4 select-none py-16">
            <div className="w-14 h-14 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center shadow-md">
              <img 
                src="/logo.png" 
                alt="Logo" 
                className="w-10 h-10 object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = 'https://api.dicebear.com/7.x/bottts/svg?seed=Cephboy&backgroundColor=ea580c';
                }}
              />
            </div>
            <h2 className="text-lg font-extrabold text-zinc-100 tracking-tight">{t.appName}</h2>
            <p className="text-zinc-400 max-w-sm text-xs leading-relaxed">
              {t.placeholder}
            </p>
          </div>
        ) : (
          (() => {
            // Helper to pair messages side-by-side
            interface MessagePair {
              userMessage?: Message;
              assistantMessage?: Message;
            }
            
            const pairs: MessagePair[] = [];
            let currentPair: { userMessage?: Message; assistantMessage?: Message } = {};

            for (const msg of conversation.messages) {
              if (msg.role === 'user') {
                if (currentPair.userMessage) {
                  pairs.push({ userMessage: currentPair.userMessage });
                  currentPair = {};
                }
                currentPair.userMessage = msg;
              } else if (msg.role === 'assistant') {
                if (currentPair.userMessage) {
                  pairs.push({
                    userMessage: currentPair.userMessage,
                    assistantMessage: msg
                  });
                  currentPair = {};
                } else {
                  pairs.push({ assistantMessage: msg });
                }
              }
            }

            if (currentPair.userMessage) {
              pairs.push({ userMessage: currentPair.userMessage });
            }

            const renderMessageContent = (message: Message) => {
              const isAssistant = message.role === 'assistant';
              return (
                <div 
                  className="flex flex-col transition-all w-full bg-transparent py-3 text-zinc-200"
                >
                  {/* Top Identifier */}
                  <div className="flex items-center gap-2 mb-2 justify-start">
                    {isAssistant ? (
                      <>
                        <img 
                          src="/logo.png" 
                          alt="Logo" 
                          className="w-3.5 h-3.5 object-cover rounded-sm"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = 'https://api.dicebear.com/7.x/bottts/svg?seed=Cephboy&backgroundColor=ea580c';
                          }}
                        />
                        <span className="font-extrabold text-[10px] tracking-wider uppercase text-zinc-400">
                          Cephboy AI GPT
                        </span>
                      </>
                    ) : (
                      <User className="w-4 h-4 text-zinc-500" />
                    )}
                  </div>

                  {/* Content Block */}
                  <div className="flex-1 min-w-0 space-y-3">
                    {/* Citations Box */}
                    {isAssistant && message.citations && message.citations.length > 0 && (
                      <div className="pt-1 flex flex-wrap gap-2 border-b border-zinc-900 pb-2.5 mb-1.5">
                        <div className="text-[9px] text-zinc-500 w-full mb-1 uppercase tracking-widest font-extrabold">Sources Consultées</div>
                        {message.citations.map((cite, idx) => (
                          <a
                            key={idx}
                            href={cite.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 px-2 py-0.5 bg-zinc-900 border border-zinc-800 rounded-md text-[11px] text-zinc-300 hover:text-orange-400 hover:border-orange-900/50 transition cursor-pointer shadow-xs"
                            title={cite.snippet || cite.title}
                          >
                            {getSourceIcon(cite.source)}
                            <span className="max-w-[120px] truncate font-medium">{cite.title}</span>
                            <ExternalLink className="w-2 h-2 opacity-50" />
                          </a>
                        ))}
                    </div>
                  )}

                  {/* Markdown Renderer */}
                    <div className="space-y-3 text-[15px] sm:text-[16.5px] leading-relaxed text-zinc-200 break-words font-sans">
                      <StreamingMarkdown 
                        content={message.content} 
                        isStreaming={message.isStreaming} 
                      />
                    </div>
                    {message.imageUrl && (
                      <div className="mt-4 relative group overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 max-w-lg shadow-md">
                        <img 
                          src={message.imageUrl || null} 
                          alt={message.content} 
                          className="w-full h-auto object-cover max-h-[450px] rounded-xl transition-all duration-300 group-hover:brightness-95"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3 backdrop-blur-xs">
                          <button 
                            type="button"
                            onClick={() => downloadImage(message.imageUrl || '', 'cephboy_chat_image')}
                            className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition shadow-md"
                          >
                            <Download className="w-4 h-4" />
                            Télécharger
                          </button>
                          <button 
                            type="button"
                            onClick={() => {
                              const w = window.open();
                              if (w) {
                                w.document.write(`<img src="${message.imageUrl}" style="max-width:100%; max-height:100vh; display:block; margin:auto; background:#121214;" />`);
                              }
                            }}
                            className="px-4 py-2 bg-zinc-900/90 hover:bg-zinc-850 text-zinc-300 border border-zinc-750 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition shadow-sm"
                          >
                            <Maximize className="w-4 h-4" />
                            Agrandir
                          </button>
                        </div>
                      </div>
                    )}

                    {/* AI Studio Feedback/Action Bar at the bottom of Assistant responses */}
                    {isAssistant && (
                      <div className="flex items-center justify-between pt-4 border-t border-zinc-900/40 mt-6 text-zinc-500">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                          <span>Checkpoint</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => console.log("Feedback: ThumbsUp", message.id)}
                            className="p-1.5 hover:bg-zinc-900 hover:text-zinc-200 rounded-lg transition-colors cursor-pointer"
                            title="Utile"
                          >
                            <ThumbsUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => console.log("Feedback: ThumbsDown", message.id)}
                            className="p-1.5 hover:bg-zinc-900 hover:text-zinc-200 rounded-lg transition-colors cursor-pointer"
                            title="Inutile"
                          >
                            <ThumbsDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => copyToClipboard(message.content, message.id)}
                            className="p-1.5 hover:bg-zinc-900 hover:text-zinc-200 rounded-lg transition-colors cursor-pointer"
                            title="Copier la réponse"
                          >
                            {copiedId === message.id ? <Check className="w-3.5 h-3.5 text-orange-500 font-bold" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => downloadAsTxt(message)}
                            className="p-1.5 hover:bg-zinc-900 hover:text-zinc-200 rounded-lg transition-colors cursor-pointer"
                            title="Télécharger en TXT"
                          >
                            <FileText className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => generatePDF(message)}
                            className="p-1.5 hover:bg-zinc-900 hover:text-zinc-200 rounded-lg transition-colors cursor-pointer"
                            title="Exporter en PDF"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handlePlayTTS(message)}
                            className="p-1.5 hover:bg-zinc-900 hover:text-zinc-200 rounded-lg transition-colors cursor-pointer"
                            title={playingMessageId === message.id ? "Arrêter la lecture" : "Lire le message (TTS Cloudflare)"}
                          >
                            {audioLoadingId === message.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-500" />
                            ) : playingMessageId === message.id ? (
                              <VolumeX className="w-3.5 h-3.5 text-orange-400 animate-pulse" />
                            ) : (
                              <Volume2 className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            };

            return (
              <div className="w-full space-y-8 flex flex-col px-1 sm:px-2">
                {conversation.messages.map((message, idx) => {
                  const isAssistant = message.role === 'assistant';
                  return (
                    <div 
                      key={message.id || idx} 
                      className={`animate-in fade-in slide-in-from-bottom-2 duration-300 w-full self-start`}
                    >
                      {renderMessageContent(message)}
                    </div>
                  );
                })}
                {isGenerating && (() => {
                  const statusLower = (currentStatusText || "").toLowerCase();
                  
                  // Let's determine if this is an image, search, music, analysis or simple reflection.
                  // By default:
                  let text = "RÉDACTION DE LA RÉPONSE...";
                  const LogoIcon = () => <img src="/logo.png" alt="Logo" className="w-5 h-5 object-cover rounded-sm" onError={(e) => { (e.target as HTMLImageElement).src = 'https://api.dicebear.com/7.x/bottts/svg?seed=Cephboy&backgroundColor=ea580c'; }} />;
                  let icon = <LogoIcon />;

                  // 1. Image Creation Mode
                  if (
                    isImageMode || 
                    statusLower.includes("image") || 
                    statusLower.includes("génération de l'image") || 
                    statusLower.includes("création d'image") || 
                    statusLower.includes("générer") ||
                    statusLower.includes("dessin") ||
                    statusLower.includes("photo")
                  ) {
                    text = "CRÉATION DE VOTRE IMAGE...";
                    icon = <Image className="w-5 h-5 text-orange-500" />;
                  } 
                  // 2. Web Search Mode
                  else if (
                    searchWeb || 
                    statusLower.includes("recherche") || 
                    statusLower.includes("search") || 
                    statusLower.includes("rechercher") || 
                    statusLower.includes("duckduckgo") || 
                    statusLower.includes("wikipedia") || 
                    statusLower.includes("facebook") || 
                    statusLower.includes("twitter") || 
                    statusLower.includes("x.com")
                  ) {
                    if (
                      statusLower.includes("musique") || 
                      statusLower.includes("morceaux") || 
                      statusLower.includes("chanson") || 
                      statusLower.includes("fma") || 
                      statusLower.includes("jamendo")
                    ) {
                      text = "RECHERCHE DE MUSIQUE LIBRE DE DROITS...";
                      icon = <Music className="w-5 h-5 text-orange-500" />;
                    } else {
                      text = "RECHERCHE WEB EN COURS...";
                      icon = <Search className="w-5 h-5 text-orange-500" />;
                    }
                  } 
                  // 3. Document Analysis Mode
                  else if (
                    statusLower.includes("analyse") || 
                    statusLower.includes("document") || 
                    statusLower.includes("fichier") || 
                    statusLower.includes("pdf") || 
                    statusLower.includes("word") || 
                    statusLower.includes("excel")
                  ) {
                    text = "ANALYSE DU DOCUMENT EN COURS...";
                    icon = <FileText className="w-5 h-5 text-orange-500" />;
                  }
                  // 4. Collaborative Mode / Relay
                  else if (
                    statusLower.includes("analyse collaborative") || 
                    statusLower.includes("relais") || 
                    statusLower.includes("finalisation") || 
                    statusLower.includes("cephgpt-2")
                  ) {
                    text = "RELAIS COLLABORATIF EN COURS...";
                    icon = <LogoIcon />;
                  } 
                  // 5. Default Thinking State
                  else {
                    text = "RÉFLEXION EN COURS...";
                    icon = <LogoIcon />;
                  }

                  // If currentStatusText is highly specific (not generic like Connexion / Initialisation), use it as a subtext or sub-header to be perfectly direct!
                  const showDetail = currentStatusText && 
                    !statusLower.includes("initialisation") && 
                    !statusLower.includes("connexion") &&
                    currentStatusText !== text;

                  return (
                    <div className="py-6 border-t border-zinc-900/20 flex flex-col space-y-3 self-start w-full">
                      <div className="flex items-center gap-3">
                        {icon}
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-orange-500 uppercase tracking-widest">{text}</span>
                          {showDetail && (
                            <span className="text-[11px] text-zinc-400 mt-0.5 font-medium">{currentStatusText}</span>
                          )}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="h-2.5 bg-zinc-950/40 rounded-full w-3/4 animate-pulse" />
                        <div className="h-2.5 bg-zinc-950/30 rounded-full w-1/2 animate-pulse" />
                      </div>
                    </div>
                  );
                })()}
                <div ref={messagesEndRef} />
              </div>
            );
          })()
        )}
      </div>

      {/* Input panel & controls designed in Google AI Studio style */}
      <ChatInput 
        onSendMessage={onSendMessage}
        onUploadFile={onUploadFile}
        isGenerating={isGenerating}
        searchWeb={searchWeb}
        setSearchWeb={setSearchWeb}
        isImageMode={isImageMode}
        setIsImageMode={setIsImageMode}
        imageEngine={imageEngine}
        setImageEngine={setImageEngine}
        selectedModel={selectedModel}
        onSelectedModelChange={onSelectedModelChange}
        t={t}
      />
    </div>
  );
}

function ChatInput({
  onSendMessage,
  onUploadFile,
  isGenerating,
  searchWeb,
  setSearchWeb,
  isImageMode,
  setIsImageMode,
  imageEngine,
  setImageEngine,
  selectedModel,
  onSelectedModelChange,
  t
}: {
  onSendMessage: ChatAreaProps['onSendMessage'];
  onUploadFile: ChatAreaProps['onUploadFile'];
  isGenerating: boolean;
  searchWeb: boolean;
  setSearchWeb: (val: boolean) => void;
  isImageMode: boolean;
  setIsImageMode: (val: boolean) => void;
  imageEngine: ChatAreaProps['imageEngine'];
  setImageEngine: ChatAreaProps['setImageEngine'];
  selectedModel: ChatAreaProps['selectedModel'];
  onSelectedModelChange: ChatAreaProps['onSelectedModelChange'];
  t: any;
}) {
  const [inputValue, setInputValue] = useState('');
  const [showInputParams, setShowInputParams] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFilePreview, setSelectedFilePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isGenerating) return;

    if (selectedFile) {
      onUploadFile(selectedFile, inputValue.trim());
      setInputValue('');
      setSelectedFile(null);
      setSelectedFilePreview(null);
      return;
    }

    if (!inputValue.trim()) return;
    
    if (isImageMode) {
      onSendMessage(inputValue.trim(), false, [], imageEngine);
    } else {
      onSendMessage(inputValue.trim(), searchWeb, ['duckduckgo', 'wikipedia']);
    }
    setInputValue('');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setSelectedFilePreview(reader.result as string);
        };
        reader.readAsDataURL(file);
      } else {
        setSelectedFilePreview(null);
      }
    }
    // Reset input
    e.target.value = '';
  };

  const handleCancelFile = () => {
    setSelectedFile(null);
    setSelectedFilePreview(null);
  };

  return (
    <footer className="p-6 md:p-8 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a] to-transparent sticky bottom-0">
        <form onSubmit={handleSubmit} className="w-full space-y-4">
          
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept="image/*,.pdf,.docx,.xlsx,.csv,.txt" 
            onChange={(e) => handleFileChange(e)} 
          />

          {/* Preview block for selected file */}
          {selectedFile && (
            <div className="p-3 bg-zinc-900/90 border border-zinc-800 rounded-2xl flex items-center justify-between gap-3 shadow-lg max-w-md animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="flex items-center gap-3 min-w-0">
                {selectedFilePreview ? (
                  <img 
                    src={selectedFilePreview || null} 
                    alt="Selected preview" 
                    className="w-12 h-12 rounded-lg object-cover border border-zinc-750 flex-shrink-0" 
                  />
                ) : (
                  <div className="w-12 h-12 bg-zinc-800/80 rounded-lg flex items-center justify-center border border-zinc-700 flex-shrink-0">
                    <FileText className="w-6 h-6 text-zinc-400" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-zinc-100 truncate">{selectedFile.name}</p>
                  <p className="text-[10px] text-zinc-500 font-mono">
                    {(selectedFile.size / 1024).toFixed(1)} KB • {selectedFile.type || 'Fichier'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCancelFile}
                className="p-1.5 hover:bg-zinc-800 text-zinc-400 hover:text-red-400 rounded-lg transition-colors cursor-pointer"
                title="Annuler la sélection"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Actual Google AI Studio style text input container */}
          <div className="flex flex-col bg-[#121214] border border-zinc-800/80 focus-within:border-zinc-700/80 focus-within:ring-2 focus-within:ring-blue-500/10 rounded-2xl p-2.5 transition-all shadow-md">
            
            {showInputParams && (
              <div className="flex flex-col gap-2.5 pb-2.5 mb-2 border-b border-zinc-850 text-zinc-300 animate-in fade-in slide-in-from-bottom-2 duration-150">
                {/* AI Engine Selection - Hidden per user request */}
                <div className="hidden">
                  {/* ... contents ... */}
                </div>

                {/* Modes / Features */}
                <div className="space-y-1">
                  <div className="text-[9px] font-extrabold uppercase tracking-widest text-zinc-500">
                    Mode de Recherche & Contenu :
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setSearchWeb(!searchWeb);
                        if (!searchWeb) {
                          setIsImageMode(false);
                        }
                      }}
                      className={`px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 border transition-all cursor-pointer ${
                        searchWeb 
                          ? 'bg-orange-950/45 border-orange-900/50 text-orange-400 shadow-xs'
                          : 'bg-zinc-900/40 border-zinc-850/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                      }`}
                    >
                      <Globe className="w-3 h-3" />
                      Recherche Web
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const newVal = !isImageMode;
                        setIsImageMode(newVal);
                        if (newVal) {
                          setSearchWeb(false);
                        }
                      }}
                      className={`px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 border transition-all cursor-pointer ${
                        isImageMode 
                          ? 'bg-orange-950/45 border-orange-900/50 text-orange-400 shadow-xs'
                          : 'bg-zinc-900/40 border-zinc-850/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                      }`}
                    >
                      <Image className="w-3 h-3" />
                      Générer Image
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Input text field */}
            <textarea
              rows={1}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder={isImageMode ? t.generatingImage : t.placeholder}
              className="w-full bg-transparent border-0 outline-none text-zinc-100 placeholder-zinc-500 px-3 py-2 text-base md:text-[17px] max-h-36 resize-none focus:ring-0 focus:outline-none"
              style={{ minHeight: '52px' }}
            />
            
            {/* Bottom action row */}
            <div className="flex items-center justify-between border-t border-zinc-900/40 pt-2 px-1">
              
              {/* Left Action Buttons */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-full transition-colors cursor-pointer"
                  title="Uploader une image ou un document"
                >
                  <Plus className="w-5 h-5" />
                </button>

                <button
                  type="button"
                  onClick={() => setShowInputParams(!showInputParams)}
                  className={`p-2 rounded-full transition-colors cursor-pointer relative ${
                    showInputParams ? 'text-orange-400 bg-zinc-800/60' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
                  }`}
                  title="Paramètres de discussion"
                >
                  <Sliders className="w-5 h-5" />
                  {!showInputParams && (selectedModel !== 'duo' || searchWeb || isImageMode) && (
                    <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-orange-500 rounded-full ring-1 ring-zinc-950 animate-pulse" />
                  )}
                </button>
              </div>

              {/* Right Action Buttons */}
              <div className="flex items-center gap-2">
                <div className="hidden">
                  {selectedModel === 'cephgpt1' ? 'CephGPT-1' : selectedModel === 'cephgpt2' ? 'CephGPT-2' : 'Duo Collaboratif'} • {searchWeb ? "Recherche Web" : isImageMode ? "Mode Image" : "Standard"}
                </div>
                
                <button
                  type="submit"
                  disabled={(!inputValue.trim() && !selectedFile) || isGenerating}
                  className={`w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                    (inputValue.trim() || selectedFile) && !isGenerating
                      ? 'bg-zinc-100 hover:bg-white text-zinc-950 active:scale-95 shadow-md shadow-black/20'
                      : 'bg-zinc-850 text-zinc-600 cursor-not-allowed'
                  }`}
                >
                  <ArrowUp className="w-5 h-5 stroke-[2.5]" />
                </button>
              </div>
            </div>
          </div>
        </form>
      </footer>
  );
}
