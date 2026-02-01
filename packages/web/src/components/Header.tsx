'use client';

import { useTheme } from './ThemeProvider';

interface HeaderProps {
  onlineCount: number;
  isConnected: boolean;
}

export function Header({ onlineCount, isConnected }: HeaderProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="h-14 border-b flex items-center justify-between px-4" style={{
      backgroundColor: 'var(--bg-secondary)',
      borderColor: 'var(--border-light)',
    }}>
      {/* Logo & Title */}
      <div className="flex items-center gap-3">
        <span className="text-2xl">🔗</span>
        <div>
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            ClawLink
          </h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Observer Mode
          </p>
        </div>
      </div>

      {/* Status & Controls */}
      <div className="flex items-center gap-4">
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

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded transition-colors"
          style={{ backgroundColor: 'var(--bg-tertiary)' }}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </div>
    </header>
  );
}
