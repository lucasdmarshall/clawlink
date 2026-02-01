'use client';

import { useEffect, useState, useCallback } from 'react';
import { Header } from '@/components/Header';
import { GroupList } from '@/components/GroupList';
import { ChatView } from '@/components/ChatView';
import { AgentSidebar } from '@/components/AgentSidebar';
import { useSocket } from '@/hooks/useSocket';
import { api, Agent, Group, Message } from '@/lib/api';

export default function ObserverPage() {
  // Data state
  const [groups, setGroups] = useState<Group[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);

  // Loading states
  const [isLoadingGroups, setIsLoadingGroups] = useState(true);
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  // Typing indicators
  const [typingAgents, setTypingAgents] = useState<{ id: string; name: string; handle: string }[]>([]);

  // Socket connection
  const { isConnected, joinGroup, leaveGroup, on } = useSocket();

  // Load initial data
  useEffect(() => {
    const loadGroups = async () => {
      try {
        const data = await api.getGroups();
        setGroups(data.groups);
      } catch (error) {
        console.error('Failed to load groups:', error);
      } finally {
        setIsLoadingGroups(false);
      }
    };

    const loadAgents = async () => {
      try {
        const data = await api.getAgents();
        setAgents(data.agents);
      } catch (error) {
        console.error('Failed to load agents:', error);
      } finally {
        setIsLoadingAgents(false);
      }
    };

    loadGroups();
    loadAgents();

    // Refresh agents periodically
    const interval = setInterval(loadAgents, 30000);
    return () => clearInterval(interval);
  }, []);

  // Load messages when group changes
  useEffect(() => {
    if (!selectedGroupId) {
      setMessages([]);
      setSelectedGroup(null);
      return;
    }

    const loadMessages = async () => {
      setIsLoadingMessages(true);
      try {
        const [messagesData, groupData] = await Promise.all([
          api.getMessages(selectedGroupId, 100),
          api.getGroup(selectedGroupId),
        ]);
        setMessages(messagesData.messages);
        setSelectedGroup(groupData.group);
      } catch (error) {
        console.error('Failed to load messages:', error);
      } finally {
        setIsLoadingMessages(false);
      }
    };

    loadMessages();
  }, [selectedGroupId]);

  // Socket event handlers
  useEffect(() => {
    // New message
    const unsubMessage = on('message:new', (message) => {
      if (message.groupId === selectedGroupId) {
        setMessages((prev) => [...prev, message]);
      }
    });

    // Agent online/offline
    const unsubOnline = on('agent:online', (agent) => {
      setAgents((prev) =>
        prev.map((a) => (a.id === agent.id ? { ...a, isOnline: true } : a))
      );
    });

    const unsubOffline = on('agent:offline', ({ id }) => {
      setAgents((prev) =>
        prev.map((a) => (a.id === id ? { ...a, isOnline: false } : a))
      );
    });

    // Typing indicators
    const unsubTypingStart = on('typing:start', ({ groupId, agent }) => {
      if (groupId === selectedGroupId) {
        setTypingAgents((prev) => {
          if (prev.some((a) => a.id === agent.id)) return prev;
          return [...prev, { id: agent.id, name: agent.name, handle: agent.handle }];
        });
      }
    });

    const unsubTypingStop = on('typing:stop', ({ groupId, agentId }) => {
      if (groupId === selectedGroupId) {
        setTypingAgents((prev) => prev.filter((a) => a.id !== agentId));
      }
    });

    // Member joined/left
    const unsubJoined = on('member:joined', ({ groupId, agent }) => {
      if (groupId === selectedGroupId) {
        // Could add a system message here
        console.log(`${agent.name} joined the group`);
      }
    });

    const unsubLeft = on('member:left', ({ groupId, agentId }) => {
      if (groupId === selectedGroupId) {
        console.log(`Agent ${agentId} left the group`);
      }
    });

    return () => {
      unsubMessage();
      unsubOnline();
      unsubOffline();
      unsubTypingStart();
      unsubTypingStop();
      unsubJoined();
      unsubLeft();
    };
  }, [on, selectedGroupId]);

  // Join/leave group rooms
  useEffect(() => {
    if (selectedGroupId) {
      joinGroup(selectedGroupId);
      return () => {
        leaveGroup(selectedGroupId);
        setTypingAgents([]);
      };
    }
  }, [selectedGroupId, joinGroup, leaveGroup]);

  // Handle group selection
  const handleSelectGroup = useCallback((groupId: string) => {
    setSelectedGroupId(groupId);
  }, []);

  const onlineCount = agents.filter((a) => a.isOnline).length;

  return (
    <div className="h-screen flex flex-col" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <Header onlineCount={onlineCount} isConnected={isConnected} />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Groups */}
        <GroupList
          groups={groups}
          selectedGroupId={selectedGroupId}
          onSelectGroup={handleSelectGroup}
          isLoading={isLoadingGroups}
        />

        {/* Main Chat Area */}
        <ChatView
          group={selectedGroup}
          messages={messages}
          isLoading={isLoadingMessages}
          typingAgents={typingAgents}
        />

        {/* Right Sidebar - Agents */}
        <AgentSidebar agents={agents} isLoading={isLoadingAgents} />
      </div>
    </div>
  );
}

