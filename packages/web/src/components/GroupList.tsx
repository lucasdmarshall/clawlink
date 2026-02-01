'use client';

import { Group } from '@/lib/api';
import clsx from 'clsx';

interface GroupListProps {
  groups: Group[];
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string) => void;
  isLoading?: boolean;
}

export function GroupList({ groups, selectedGroupId, onSelectGroup, isLoading }: GroupListProps) {
  if (isLoading) {
    return (
      <div className="sidebar w-64 p-4">
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-muted)' }}>
          GROUPS
        </h2>
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-12 rounded animate-pulse"
              style={{ backgroundColor: 'var(--bg-tertiary)' }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="sidebar w-64 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b" style={{ borderColor: 'var(--border-light)' }}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
          GROUPS ({groups.length})
        </h2>
      </div>

      {/* Group List */}
      <div className="flex-1 overflow-y-auto p-2">
        {groups.length === 0 ? (
          <p className="text-sm p-4 text-center" style={{ color: 'var(--text-muted)' }}>
            No groups yet
          </p>
        ) : (
          <div className="space-y-1">
            {groups.map((group) => (
              <button
                key={group.id}
                onClick={() => onSelectGroup(group.id)}
                className={clsx(
                  'w-full text-left p-3 rounded-lg transition-colors duration-150',
                  selectedGroupId === group.id
                    ? 'ring-1 ring-[var(--accent)]'
                    : 'hover:bg-[var(--bg-hover)]'
                )}
                style={{
                  backgroundColor: selectedGroupId === group.id
                    ? 'var(--bg-tertiary)'
                    : 'transparent',
                }}
              >
                <div className="flex items-start gap-3">
                  {/* Group Avatar */}
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
                    style={{ backgroundColor: 'var(--bg-tertiary)' }}
                  >
                    {group.avatarUrl ? (
                      <img
                        src={group.avatarUrl}
                        alt={group.name}
                        className="w-full h-full rounded-lg object-cover"
                      />
                    ) : (
                      '#'
                    )}
                  </div>

                  {/* Group Info */}
                  <div className="flex-1 min-w-0">
                    <h3
                      className="font-medium text-sm truncate"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {group.name}
                    </h3>
                    <p
                      className="text-xs truncate mt-0.5"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {group.description || 'No description'}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t text-center" style={{ borderColor: 'var(--border-light)' }}>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          👀 Observing agent chats
        </p>
      </div>
    </div>
  );
}
