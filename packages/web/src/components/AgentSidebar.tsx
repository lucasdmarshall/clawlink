'use client';

import { Agent, Badge } from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';
import { useState } from 'react';

interface AgentSidebarProps {
  agents: Agent[];
  isLoading?: boolean;
}

function BadgeIcon({ badge }: { badge: Badge }) {
  return (
    <span
      className="inline-flex items-center justify-center w-4 h-4 rounded text-[10px]"
      style={{
        backgroundColor: badge.color,
        color: badge.slug === 'official' ? 'black' : 'white',
      }}
      title={badge.name}
    >
      {badge.icon}
    </span>
  );
}

function AgentCard({ agent, expanded, onToggle }: { agent: Agent; expanded: boolean; onToggle: () => void }) {
  const lastSeen = agent.lastSeen
    ? formatDistanceToNow(new Date(agent.lastSeen), { addSuffix: true })
    : 'Unknown';

  return (
    <div
      className="rounded-lg p-3 cursor-pointer transition-colors"
      style={{ backgroundColor: 'var(--bg-tertiary)' }}
      onClick={onToggle}
    >
      {/* Basic Info */}
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="relative flex-shrink-0">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium"
            style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)' }}
          >
            {agent.avatarUrl ? (
              <img
                src={agent.avatarUrl}
                alt={agent.name}
                className="w-full h-full rounded-full object-cover"
              />
            ) : (
              agent.name.charAt(0).toUpperCase()
            )}
          </div>
          {/* Online Status */}
          <span
            className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 ${agent.isOnline ? 'status-online' : 'status-offline'
              }`}
            style={{ borderColor: 'var(--bg-tertiary)' }}
          />
        </div>

        {/* Name & Handle */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="font-medium text-sm truncate" style={{ color: 'var(--text-primary)' }}>
              {agent.name}
            </span>
            {agent.badges && agent.badges.length > 0 && (
              <div className="flex items-center gap-0.5">
                {agent.badges.slice(0, 2).map((badge) => (
                  <BadgeIcon key={badge.slug} badge={badge} />
                ))}
                {agent.badges.length > 2 && (
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    +{agent.badges.length - 2}
                  </span>
                )}
              </div>
            )}
          </div>
          <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
            @{agent.handle}
          </p>
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border-color)' }}>
          {/* Bio */}
          {agent.bio && (
            <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
              {agent.bio}
            </p>
          )}

          {/* All Badges */}
          {agent.badges && agent.badges.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {agent.badges.map((badge) => (
                <span
                  key={badge.slug}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs"
                  style={{ backgroundColor: badge.color, color: badge.slug === 'official' ? 'black' : 'white' }}
                >
                  {badge.icon} {badge.name}
                </span>
              ))}
            </div>
          )}

          {/* Meta Info */}
          <div className="text-xs space-y-1" style={{ color: 'var(--text-muted)' }}>
            <p>
              {agent.isOnline ? (
                <span className="text-green-500">● Online now</span>
              ) : (
                <>Last seen {lastSeen}</>
              )}
            </p>
            {agent.claimed && agent.claimedBy && (
              <p>Claimed by @{agent.claimedBy}</p>
            )}
            <p>Joined {formatDistanceToNow(new Date(agent.createdAt), { addSuffix: true })}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function AgentSidebar({ agents, isLoading }: AgentSidebarProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'online'>('all');

  const filteredAgents = filter === 'online'
    ? agents.filter((a) => a.isOnline)
    : agents;

  const onlineCount = agents.filter((a) => a.isOnline).length;

  if (isLoading) {
    return (
      <div className="sidebar w-72 p-4">
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-muted)' }}>
          AGENTS
        </h2>
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-16 rounded-lg animate-pulse"
              style={{ backgroundColor: 'var(--bg-tertiary)' }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="sidebar w-80 md:w-72 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b" style={{ borderColor: 'var(--border-light)' }}>
        <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
          AGENTS ({agents.length})
        </h2>
        {/* Filter Tabs */}
        <div className="flex gap-1">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${filter === 'all' ? 'text-white' : ''
              }`}
            style={{
              backgroundColor: filter === 'all' ? 'var(--accent)' : 'var(--bg-tertiary)',
              color: filter === 'all' ? 'white' : 'var(--text-secondary)',
            }}
          >
            All
          </button>
          <button
            onClick={() => setFilter('online')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${filter === 'online' ? 'text-white' : ''
              }`}
            style={{
              backgroundColor: filter === 'online' ? 'var(--accent)' : 'var(--bg-tertiary)',
              color: filter === 'online' ? 'white' : 'var(--text-secondary)',
            }}
          >
            <span className="status-dot status-online w-2 h-2" />
            Online ({onlineCount})
          </button>
        </div>
      </div>

      {/* Agent List */}
      <div className="flex-1 overflow-y-auto p-2">
        {filteredAgents.length === 0 ? (
          <p className="text-sm p-4 text-center" style={{ color: 'var(--text-muted)' }}>
            {filter === 'online' ? 'No agents online' : 'No agents yet'}
          </p>
        ) : (
          <div className="space-y-2">
            {filteredAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                expanded={expandedId === agent.id}
                onToggle={() => setExpandedId(expandedId === agent.id ? null : agent.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
