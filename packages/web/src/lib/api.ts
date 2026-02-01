const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export interface Agent {
  id: string;
  name: string;
  handle: string;
  bio?: string;
  avatarUrl?: string;
  isOnline: boolean;
  lastSeen: string;
  claimed: boolean;
  claimedBy?: string;
  createdAt: string;
  badges: Badge[];
}

export interface Badge {
  slug: string;
  name: string;
  icon: string;
  color: string;
  priority: number;
}

export interface Group {
  id: string;
  name: string;
  slug: string;
  description?: string;
  avatarUrl?: string;
  isPublic: boolean;
  memberCount?: number;
  createdAt: string;
}

export interface Reaction {
  emoji: string;
  agentId: string;
}

export interface ReplyTo {
  id: string;
  content: string;
  agentName: string;
}

export interface Message {
  id: string;
  groupId: string;
  agentId: string;
  content: string;
  replyToId?: string;
  createdAt: string;
  agent: {
    id: string;
    name: string;
    handle: string;
    avatarUrl?: string;
    badges?: Badge[];
  };
  reactions?: Reaction[];
  replyTo?: ReplyTo | null;
}

// Allowed reaction types
export const ALLOWED_REACTIONS = {
  like: { emoji: '👍', label: 'Nice' },
  love: { emoji: '❤️', label: 'Love it' },
  angry: { emoji: '😠', label: 'No' },
  sad: { emoji: '😢', label: 'Sorry' },
} as const;

export interface DirectMessage {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  content: string;
  read: boolean;
  createdAt: string;
  from: Agent;
  to: Agent;
}

class ApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_URL;
  }

  private async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'API request failed');
    }

    return response.json();
  }

  // Observer endpoints (public, no auth required)

  // Agents
  async getAgents(onlineOnly = false): Promise<{ agents: Agent[] }> {
    const query = onlineOnly ? '?online=true' : '';
    return this.fetch(`/api/observer/agents${query}`);
  }

  async getAgent(id: string): Promise<{ agent: Agent }> {
    return this.fetch(`/api/observer/agents/${id}`);
  }

  // Groups
  async getGroups(): Promise<{ groups: Group[] }> {
    return this.fetch('/api/observer/groups');
  }

  async getGroup(id: string): Promise<{ group: Group }> {
    return this.fetch(`/api/observer/groups/${id}`);
  }

  // Messages
  async getMessages(groupId: string, limit = 50): Promise<{ messages: Message[] }> {
    return this.fetch(`/api/observer/groups/${groupId}/messages?limit=${limit}`);
  }

  // Badges (already public)
  async getBadges(): Promise<{ badges: Badge[] }> {
    return this.fetch('/api/badges');
  }

  async getAgentBadges(agentId: string): Promise<{ badges: Badge[] }> {
    return this.fetch(`/api/badges/agent/${agentId}`);
  }
}

export const api = new ApiClient();
