export interface Citation {
  title: string;
  url: string;
  snippet?: string;
  source: 'github' | 'duckduckgo' | 'wikipedia' | 'hackernews' | 'reddit' | 'general';
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  citations?: Citation[];
  providerUsed?: string;
  isStreaming?: boolean;
  imageUrl?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

export interface ProviderState {
  name: string;
  displayName: string;
  url: string;
  status: 'online' | 'offline' | 'checking';
  latency?: number;
  priority: number;
}
