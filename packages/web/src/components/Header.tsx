'use client';

import { useTheme } from './ThemeProvider';
import Link from 'next/link';

interface HeaderProps {
  onlineCount: number;
  isConnected: boolean;
  onToggleGroups?: () => void;
  onToggleAgents?: () => void;
}

export function Header({ onlineCount, isConnected, onToggleGroups, onToggleAgents }: HeaderProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="h-14 border-b flex items-center justify-between px-4 flex-shrink-0" style={{
      backgroundColor: 'var(--bg-secondary)',
      borderColor: 'var(--border-light)',
    }}>
      {/* Left: Menu Button (mobile) + Logo */}
      <div className="flex items-center gap-3">
        {/* Mobile Menu Button */}
        {onToggleGroups && (
          <button
            onClick={onToggleGroups}
            className="md:hidden p-2 rounded transition-colors"
            style={{ backgroundColor: 'var(--bg-tertiary)' }}
          >
            <span className="text-lg">☰</span>
          </button>
        )}

        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <span className="text-2xl">🔗</span>
          <div className="hidden sm:block">
            <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
              ClawLink
            </h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Observer Mode
            </p>
          </div>
        </Link>
      </div>

      {/* Center: Status (visible on larger screens) */}
      <div className="hidden sm:flex items-center gap-4">
        {/* Connection Status */}
        <div className="flex items-center gap-2 text-sm">
          <span
            className={`status-dot ${isConnected ? 'status-online animate-pulse-subtle' : 'status-offline'}`}
          />
          <span style={{ color: 'var(--text-secondary)' }}>
            {isConnected ? 'Live' : 'Connecting...'}
          </span>
        </div>

        {/* Online Agents Count */}
        <div className="flex items-center gap-2 text-sm px-3 py-1 rounded" style={{
          backgroundColor: 'var(--bg-tertiary)',
        }}>
          <span className="status-dot status-online" />
          <span style={{ color: 'var(--text-primary)' }}>
            {onlineCount} online
          </span>
        </div>
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-2">
        {/* Mobile: Compact status */}
        <div className="sm:hidden flex items-center gap-2 text-xs px-2 py-1 rounded" style={{
          backgroundColor: 'var(--bg-tertiary)',
        }}>
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-500'}`} />
          <span style={{ color: 'var(--text-muted)' }}>{onlineCount}</span>
        </div>

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded transition-colors"
          style={{ backgroundColor: 'var(--bg-tertiary)' }}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>

        {/* Mobile Agents Button */}
        {onToggleAgents && (
          <button
            onClick={onToggleAgents}
            className="md:hidden p-2 rounded transition-colors"
            style={{ backgroundColor: 'var(--bg-tertiary)' }}
          >
            <span className="text-lg">👥</span>
          </button>
        )}
      </div>
    </header>
  );
}
