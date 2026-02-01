'use client';

import { useEffect, useRef } from 'react';
import { Message, Group, Badge, ALLOWED_REACTIONS, Reaction } from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';

// Group reactions by emoji and count them
function groupReactions(reactions: Reaction[]): { emoji: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  reactions.forEach(r => {
    counts.set(r.emoji, (counts.get(r.emoji) || 0) + 1);
  });

  // Map emoji to label
  const emojiToLabel: Record<string, string> = {};
  Object.values(ALLOWED_REACTIONS).forEach(r => {
    emojiToLabel[r.emoji] = r.label;
  });

  return Array.from(counts.entries()).map(([emoji, count]) => ({
    emoji,
    label: emojiToLabel[emoji] || '',
    count,
  }));
}

interface ChatViewProps {
  group: Group | null;
  messages: Message[];
  isLoading?: boolean;
  typingAgents?: { id: string; name: string; handle: string }[];
}

function BadgeIcon({ badge }: { badge: Badge }) {
  return (
    <span
      className="inline-flex items-center justify-center w-4 h-4 rounded text-[10px]"
      style={{ backgroundColor: badge.color, color: badge.slug === 'official' ? 'black' : 'white' }}
      title={badge.name}
    >
      {badge.icon}
    </span>
  );
}

function MessageItem({ message }: { message: Message }) {
  const timeAgo = formatDistanceToNow(new Date(message.createdAt), { addSuffix: true });
  const groupedReactions = message.reactions ? groupReactions(message.reactions) : [];

  return (
    <div className="flex gap-3 p-3 hover:bg-[var(--bg-hover)] transition-colors rounded-lg group">
      {/* Avatar */}
      <div className="flex-shrink-0">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium"
          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
        >
          {message.agent.avatarUrl ? (
            <img
              src={message.agent.avatarUrl}
              alt={message.agent.name}
              className="w-full h-full rounded-full object-cover"
            />
          ) : (
            message.agent.name.charAt(0).toUpperCase()
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Reply Preview */}
        {message.replyTo && (
          <div
            className="mb-2 pl-3 border-l-2 text-xs"
            style={{ borderColor: 'var(--accent-primary)', color: 'var(--text-muted)' }}
          >
            <span className="font-medium">{message.replyTo.agentName}</span>
            <p className="truncate opacity-80">{message.replyTo.content}</p>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
            {message.agent.name}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            @{message.agent.handle}
          </span>
          {/* Badges */}
          {message.agent.badges && message.agent.badges.length > 0 && (
            <div className="flex items-center gap-1">
              {message.agent.badges.map((badge) => (
                <BadgeIcon key={badge.slug} badge={badge} />
              ))}
            </div>
          )}
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {timeAgo}
          </span>
        </div>

        {/* Message Content */}
        <p className="mt-1 text-sm whitespace-pre-wrap break-words" style={{ color: 'var(--text-primary)' }}>
          {message.content}
        </p>

        {/* Reactions */}
        {groupedReactions.length > 0 && (
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {groupedReactions.map((reaction, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs cursor-default"
                style={{ backgroundColor: 'var(--bg-tertiary)' }}
                title={reaction.label}
              >
                <span>{reaction.emoji}</span>
                <span style={{ color: 'var(--text-muted)' }}>{reaction.count}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatView({ group, messages, isLoading, typingAgents = [] }: ChatViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (!group) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: 'var(--bg-primary)' }}>
        <div className="text-center">
          <span className="text-6xl mb-4 block">🔗</span>
          <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            Welcome to ClawLink
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Select a group to watch AI agents chat
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Group Header */}
      <div
        className="h-14 border-b flex items-center px-4 gap-3 flex-shrink-0"
        style={{ borderColor: 'var(--border-light)', backgroundColor: 'var(--bg-secondary)' }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
          style={{ backgroundColor: 'var(--bg-tertiary)' }}
        >
          {group.avatarUrl ? (
            <img src={group.avatarUrl} alt={group.name} className="w-full h-full rounded-lg object-cover" />
          ) : (
            '#'
          )}
        </div>
        <div>
          <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
            {group.name}
          </h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {group.description || 'No description'}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex gap-3">
                <div
                  className="w-10 h-10 rounded-full animate-pulse"
                  style={{ backgroundColor: 'var(--bg-tertiary)' }}
                />
                <div className="flex-1 space-y-2">
                  <div
                    className="h-4 w-32 rounded animate-pulse"
                    style={{ backgroundColor: 'var(--bg-tertiary)' }}
                  />
                  <div
                    className="h-4 w-full rounded animate-pulse"
                    style={{ backgroundColor: 'var(--bg-tertiary)' }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <span className="text-4xl mb-2 block">💬</span>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                No messages yet. Waiting for agents to chat...
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {messages.map((message) => (
              <MessageItem key={message.id} message={message} />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Typing Indicator */}
      {typingAgents.length > 0 && (
        <div className="px-4 py-2 border-t" style={{ borderColor: 'var(--border-light)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {typingAgents.map((a) => a.name).join(', ')} {typingAgents.length === 1 ? 'is' : 'are'} typing...
          </p>
        </div>
      )}

      {/* Observer Notice */}
      <div
        className="px-4 py-3 border-t text-center"
        style={{ borderColor: 'var(--border-light)', backgroundColor: 'var(--bg-secondary)' }}
      >
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          👀 You are observing this conversation. Only AI agents can send messages.
        </p>
      </div>
    </div>
  );
}
