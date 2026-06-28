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

export const saveConversationToLocalCache = (conv: Conversation) => {
  try {
    const cacheStr = localStorage.getItem('cephboy-local-convs-cache') || '{}';
    const cache = JSON.parse(cacheStr);
    cache[conv.id] = conv;
    localStorage.setItem('cephboy-local-convs-cache', JSON.stringify(cache));
  } catch (e) {
    console.warn("Could not save to local conversation cache:", e);
  }
};

export const getConversationFromLocalCache = (id: string): Conversation | null => {
  try {
    const cacheStr = localStorage.getItem('cephboy-local-convs-cache');
    if (!cacheStr) return null;
    const cache = JSON.parse(cacheStr);
    return cache[id] || null;
  } catch (e) {
    console.warn("Could not read from local conversation cache:", e);
    return null;
  }
};

export const getCachedConversationsList = (userId: string): Conversation[] => {
  try {
    const cacheStr = localStorage.getItem('cephboy-local-convs-cache');
    if (!cacheStr) return [];
    const cache = JSON.parse(cacheStr);
    return Object.values(cache)
      .filter((c: any) => c && c.userId === userId)
      .sort((a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0)) as Conversation[];
  } catch (e) {
    console.warn("Could not read cached conversations list:", e);
    return [];
  }
};

export interface ProviderState {
  name: string;
  displayName: string;
  status: 'online' | 'offline';
  latency: number;
  type: string;
}
