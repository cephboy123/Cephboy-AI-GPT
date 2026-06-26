import React, { useState, useRef, useEffect } from 'react';
import Markdown from 'react-markdown';
import { jsPDF } from 'jspdf';
import { 
  Message, 
  Citation, 
  Conversation 
} from './types';
import { translations, Language } from '../translations';
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
  X
} from 'lucide-react';

const AI_LOGO_URL = "/logo.png";

interface ChatAreaProps {
  conversation: Conversation | null;
  onSendMessage: (content: string, searchWeb: boolean, sources: string[], imageEngine?: string) => void;
  onUploadFile: (file: File) => void;
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
  imageEngine: 'pollinations' | 'gemini' | 'pixelapi';
  setImageEngine: (val: 'pollinations' | 'gemini' | 'pixelapi') => void;
  linkedinSearch: boolean;
  logoVersion?: number;
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
  logoVersion = Date.now()
}: ChatAreaProps) {
  const [inputValue, setInputValue] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const t = translations[language];

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [conversation?.messages, isGenerating, currentStatusText]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isGenerating) return;
    
    if (isImageMode) {
      onSendMessage(inputValue.trim(), false, [], imageEngine);
    } else {
      onSendMessage(inputValue.trim(), searchWeb, ['duckduckgo', 'wikipedia']);
    }
    setInputValue('');
  };

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

  const downloadImage = (url: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `cephboy_image_${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
      onUploadFile(file);
    }
    // Reset input
    e.target.value = '';
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
    <div className="flex-1 flex flex-col h-screen bg-[#0d0d0d] text-gray-200 font-sans relative">
      
      {/* Top navbar */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-[#0d0d0d]/80 backdrop-blur-md z-10 sticky top-0">
        <div className="flex items-center gap-3">
          {!isSidebarOpen && (
            <button 
              onClick={onToggleSidebar}
              className="p-2 hover:bg-white/5 rounded-lg cursor-pointer transition-colors"
              title={t.openMenu}
            >
              <Menu className="w-5 h-5 text-gray-300" />
            </button>
          )}
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-base text-white tracking-tight">{t.appName}</span>
              <span className="text-[10px] bg-green-500/10 text-green-500 border border-green-500/20 px-2 py-0.5 rounded-full font-mono font-bold tracking-wider flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                {t.online.toUpperCase()}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 md:px-32 py-10 space-y-8">
        {(!conversation || conversation.messages.length === 0) ? (
          <div className="h-full flex flex-col items-center justify-center max-w-2xl mx-auto text-center space-y-6 select-none my-auto">
            {/* Interface empty as requested */}
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-8">
            {conversation.messages.map((message) => {
              const isAssistant = message.role === 'assistant';
              return (
                <div 
                  key={message.id} 
                  className="flex gap-6 items-start"
                >
                  {/* Avatar */}
                  <div className={`w-8 h-8 rounded mt-1 flex-shrink-0 flex items-center justify-center font-bold text-[10px] overflow-hidden ${
                    isAssistant 
                      ? 'bg-orange-600/10 border border-orange-500/20 shadow-lg shadow-orange-500/10' 
                      : 'bg-white/5 border border-white/10 text-gray-400'
                  }`}>
                    {isAssistant ? (
                      <img 
                        src={`/logo.png?v=${logoVersion}`} 
                        alt="AI" 
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = 'https://api.dicebear.com/7.x/bottts/svg?seed=Cephboy&backgroundColor=ea580c';
                        }}
                      />
                    ) : "U"}
                  </div>

                  {/* Content Block */}
                  <div className="flex-1 min-w-0 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className={`font-semibold text-sm tracking-wide uppercase ${
                        isAssistant ? 'text-orange-500' : 'text-gray-400'
                      }`}>
                        {isAssistant ? (message.providerUsed || "Cephboy AI GPT") : "User"}
                      </span>
                      
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => downloadAsTxt(message)}
                          className="p-1 hover:bg-white/5 rounded text-gray-500 hover:text-gray-300 transition"
                          title="Télécharger en TXT"
                        >
                          <FileText className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => generatePDF(message)}
                          className="p-1 hover:bg-white/5 rounded text-gray-500 hover:text-gray-300 transition"
                          title="Exporter en PDF"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => copyToClipboard(message.content, message.id)}
                          className="p-1 hover:bg-white/5 rounded text-gray-500 hover:text-gray-300 transition"
                          title="Copier la réponse"
                        >
                          {copiedId === message.id ? <Check className="w-3.5 h-3.5 text-orange-500" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    {/* Citations Box */}
                    {isAssistant && message.citations && message.citations.length > 0 && (
                      <div className="pt-2 flex flex-wrap gap-2">
                        <div className="text-[10px] text-gray-500 w-full mb-1 uppercase tracking-widest font-bold">Sources Consultées</div>
                        {message.citations.map((cite, idx) => (
                          <a
                            key={idx}
                            href={cite.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1.5 px-2 py-1 bg-white/5 border border-white/10 rounded text-xs text-gray-400 hover:text-white hover:border-orange-500/30 transition cursor-pointer"
                            title={cite.snippet || cite.title}
                          >
                            {getSourceIcon(cite.source)}
                            <span className="max-w-[140px] truncate">{cite.title}</span>
                            <ExternalLink className="w-2.5 h-2.5 opacity-50" />
                          </a>
                        ))}
                      </div>
                    )}

                    {/* Markdown Renderer */}
                    <div className="space-y-4 text-base md:text-lg leading-relaxed text-gray-300 break-words font-sans">
                      <Markdown
                        components={{
                          img: ({ src, alt }) => (
                            <div className="relative group/img my-4">
                              <img src={src} alt={alt} className="rounded-lg border border-white/10 max-h-[500px] object-contain mx-auto" />
                              <button
                                onClick={() => downloadImage(src || '')}
                                className="absolute top-2 right-2 p-2 bg-black/60 backdrop-blur-sm rounded-full text-white opacity-0 group-hover/img:opacity-100 transition-opacity hover:bg-orange-500"
                                title="Télécharger l'image"
                              >
                                <Download className="w-4 h-4" />
                              </button>
                            </div>
                          ),
                          p: ({ children }) => <div className="leading-relaxed mb-4 text-gray-300 last:mb-0">{children}</div>,
                          h1: ({ children }) => <h1 className="text-xl font-bold mt-5 mb-2 text-white">{children}</h1>,
                          h2: ({ children }) => <h2 className="text-lg font-semibold mt-4 mb-2 text-white">{children}</h2>,
                          h3: ({ children }) => <h3 className="text-base font-semibold mt-3 mb-1 text-white">{children}</h3>,
                          ul: ({ children }) => <ul className="list-disc pl-5 mb-4 space-y-2 text-gray-400">{children}</ul>,
                          ol: ({ children }) => <ol className="list-decimal pl-5 mb-4 space-y-2 text-gray-400">{children}</ol>,
                          li: ({ children }) => <li className="text-base text-gray-300">{children}</li>,
                          code: ({ node, className, children, ...props }: any) => {
                            const isBlock = !/inline/.test(className || '');
                            return isBlock ? (
                              <pre className="bg-black/50 text-orange-400/90 p-4 rounded-xl overflow-x-auto my-3 text-xs font-mono border border-white/10 leading-normal">
                                <code className={className} {...props}>
                                  {children}
                                </code>
                              </pre>
                            ) : (
                              <code className="bg-white/5 text-orange-400 px-1.5 py-0.5 rounded text-xs font-mono border border-white/10" {...props}>
                                {children}
                              </code>
                            );
                          },
                          a: ({ href, children }) => (
                            <a href={href} target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:text-orange-400 underline font-medium inline-flex items-center gap-0.5">
                              {children} <ExternalLink className="w-3 h-3 inline" />
                            </a>
                          ),
                          blockquote: ({ children }) => <blockquote className="border-l-2 border-orange-500 pl-4 italic my-2 text-gray-500">{children}</blockquote>,
                        }}
                      >
                        {message.content}
                      </Markdown>
                    </div>
                    {message.imageUrl && (
                      <div className="mt-4 relative group overflow-hidden rounded-xl border border-white/10 bg-white/5 max-w-lg shadow-lg">
                        <img 
                          src={message.imageUrl} 
                          alt={message.content} 
                          className="w-full h-auto object-cover max-h-[450px] rounded-xl transition-all duration-300 group-hover:brightness-90"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                          <a 
                            href={message.imageUrl} 
                            download={`cephboy_${Date.now()}.png`}
                            target="_blank"
                            rel="noreferrer"
                            className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition shadow-md"
                          >
                            <Download className="w-4 h-4" />
                            Télécharger
                          </a>
                          <button 
                            type="button"
                            onClick={() => {
                              const w = window.open();
                              if (w) {
                                w.document.write(`<img src="${message.imageUrl}" style="max-width:100%; max-height:100vh; display:block; margin:auto; background:#101010;" />`);
                              }
                            }}
                            className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition"
                          >
                            <Maximize className="w-4 h-4" />
                            Agrandir
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Simulated/Status Streaming updates */}
            {isGenerating && currentStatusText && (
              <div className="flex gap-6 items-start animate-pulse">
                <div className="w-8 h-8 rounded mt-1 bg-orange-600/20 border border-orange-500/30 flex items-center justify-center text-orange-500">
                  <Bot className="w-4 h-4 animate-spin" />
                </div>
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-white/5 rounded-lg w-1/4" />
                  <p className="text-xs text-orange-500 font-mono tracking-wide">{currentStatusText}</p>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input panel & controls */}
      <footer className="p-8 bg-gradient-to-t from-[#0d0d0d] via-[#0d0d0d] to-transparent sticky bottom-0">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto relative space-y-3">
          
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept="image/*,.pdf,.docx,.xlsx,.csv,.txt" 
            onChange={(e) => handleFileChange(e)} 
          />

          <div className="absolute -top-6 left-4 flex gap-4">
            {searchWeb && (
              <span className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-ping" />
                Recherche Web Active
              </span>
            )}
            {isImageMode && (
              <span className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                Mode Image Actif
              </span>
            )}
            {linkedinSearch && (
              <span className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#0077b5] animate-pulse" />
                LinkedIn Connecté
              </span>
            )}
          </div>

          {/* Actual text input field */}
          <div className="relative flex items-center bg-white/5 border border-white/10 focus-within:border-orange-500/50 rounded-2xl py-3 pl-4 pr-32 transition-all">
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
              className="flex-1 bg-transparent border-0 outline-none text-white placeholder-gray-600 px-2 py-1 text-sm md:text-base max-h-36 resize-none focus:ring-0"
              style={{ minHeight: '38px' }}
            />
            
            <div className="absolute right-3 flex gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-gray-400 hover:text-orange-500 transition-all flex items-center gap-1.5 px-3 group"
                title="Uploader un fichier ou une image"
              >
                <Paperclip className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wider">Fichier</span>
              </button>
              
              <button
                type="submit"
                disabled={!inputValue.trim() || isGenerating}
                className={`p-2 rounded-xl transition cursor-pointer ${
                  inputValue.trim() && !isGenerating
                    ? 'bg-white text-black hover:bg-orange-500 hover:text-white'
                    : 'bg-white/5 text-gray-600 cursor-not-allowed'
                }`}
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
          
          <div className="text-center mt-3 text-[10px] text-gray-600 uppercase tracking-widest">
            {t.disclaimer}
          </div>
        </form>
      </footer>
    </div>
  );
}
