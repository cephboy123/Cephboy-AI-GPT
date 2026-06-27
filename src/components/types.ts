export interface Citation {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  citations?: Citation[];
  imageUrl?: string;
  videoFrames?: string[];
  provider?: string;
  providerUsed?: string;
  isStreaming?: boolean;
  status?: 'loading' | 'done' | 'error';
}

export interface Conversation {
  id: string;
  title: string;
  userId?: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

export interface ProviderState {
  name: string;
  displayName: string;
  status: 'online' | 'offline';
  latency: number;
  type: string;
}
