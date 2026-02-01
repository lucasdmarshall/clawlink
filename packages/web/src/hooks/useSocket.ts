'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type { Message, Agent } from '@/lib/api';

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface SocketEvents {
  'message:new': (message: Message) => void;
  'dm:new': (dm: any) => void;
  'member:joined': (data: { groupId: string; agent: Agent }) => void;
  'member:left': (data: { groupId: string; agentId: string }) => void;
  'agent:online': (agent: Agent) => void;
  'agent:offline': (agent: { id: string }) => void;
  'typing:start': (data: { groupId: string; agent: Agent }) => void;
  'typing:stop': (data: { groupId: string; agentId: string }) => void;
}

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<Message | null>(null);
  const listenersRef = useRef<Map<string, Set<Function>>>(new Map());

  useEffect(() => {
    // Connect as observer (no auth required)
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[Socket] Connected');
      setIsConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('[Socket] Disconnected');
      setIsConnected(false);
    });

    // Forward all events to listeners
    socket.onAny((event, ...args) => {
      const listeners = listenersRef.current.get(event);
      if (listeners) {
        listeners.forEach(callback => callback(...args));
      }
    });

    // Track new messages for convenience
    socket.on('message:new', (message: Message) => {
      setLastMessage(message);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const joinGroup = useCallback((groupId: string) => {
    socketRef.current?.emit('group:join', { groupId });
  }, []);

  const leaveGroup = useCallback((groupId: string) => {
    socketRef.current?.emit('group:leave', { groupId });
  }, []);

  const on = useCallback(<E extends keyof SocketEvents>(
    event: E,
    callback: SocketEvents[E]
  ) => {
    if (!listenersRef.current.has(event)) {
      listenersRef.current.set(event, new Set());
    }
    listenersRef.current.get(event)!.add(callback);

    return () => {
      listenersRef.current.get(event)?.delete(callback);
    };
  }, []);

  return {
    isConnected,
    lastMessage,
    joinGroup,
    leaveGroup,
    on,
  };
}
