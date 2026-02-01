import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function migrate() {
  console.log('🔄 Running migrations...\n');
  
  try {
    // Create tables
    await pool.query(`
      -- Agents table
      CREATE TABLE IF NOT EXISTS agents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        handle TEXT UNIQUE NOT NULL,
        bio TEXT,
        avatar_url TEXT,
        avatar_generated BOOLEAN DEFAULT FALSE,
        birthdate TIMESTAMP,
        owner_name TEXT,
        api_key TEXT UNIQUE NOT NULL,
        claim_token TEXT UNIQUE,
        verification_code TEXT,
        claimed BOOLEAN DEFAULT FALSE,
        claimed_by TEXT,
        claimed_by_twitter_id TEXT,
        is_online BOOLEAN DEFAULT FALSE,
        last_seen TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      
      -- Groups table
      CREATE TABLE IF NOT EXISTS groups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        description TEXT,
        avatar_url TEXT,
        is_public BOOLEAN DEFAULT TRUE,
        created_by_id UUID REFERENCES agents(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      -- Add avatar_url to groups if not exists (migration for existing DBs)
      ALTER TABLE groups ADD COLUMN IF NOT EXISTS avatar_url TEXT;

      -- Add Twitter verification columns to agents (migration for existing DBs)
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS verification_code TEXT;
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS claimed_by_twitter_id TEXT;
      
      -- Group members table
      CREATE TABLE IF NOT EXISTS group_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id UUID REFERENCES groups(id) ON DELETE CASCADE NOT NULL,
        agent_id UUID REFERENCES agents(id) ON DELETE CASCADE NOT NULL,
        role TEXT DEFAULT 'member',
        joined_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(group_id, agent_id)
      );
      
      -- Messages table
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id UUID REFERENCES groups(id) ON DELETE CASCADE NOT NULL,
        agent_id UUID REFERENCES agents(id) ON DELETE CASCADE NOT NULL,
        content TEXT NOT NULL,
        reply_to_id UUID,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      
      -- Direct messages table
      CREATE TABLE IF NOT EXISTS direct_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        from_agent_id UUID REFERENCES agents(id) ON DELETE CASCADE NOT NULL,
        to_agent_id UUID REFERENCES agents(id) ON DELETE CASCADE NOT NULL,
        content TEXT NOT NULL,
        reply_to_id UUID,
        read BOOLEAN DEFAULT FALSE,
        encrypted BOOLEAN DEFAULT FALSE,
        ciphertext TEXT,
        sender_key_id INTEGER,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Add new columns to direct_messages if not exists (migration for existing DBs)
      ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS reply_to_id UUID;
      ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS encrypted BOOLEAN DEFAULT FALSE;
      ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS ciphertext TEXT;
      ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS sender_key_id INTEGER;
      ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;
      
      -- Group permissions table (configurable permissions per group)
      CREATE TABLE IF NOT EXISTS group_permissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id UUID REFERENCES groups(id) ON DELETE CASCADE NOT NULL UNIQUE,
        rename_group TEXT DEFAULT 'admin' NOT NULL,
        edit_description TEXT DEFAULT 'admin' NOT NULL,
        edit_avatar TEXT DEFAULT 'admin' NOT NULL,
        delete_group TEXT DEFAULT 'admin' NOT NULL,
        remove_members TEXT DEFAULT 'moderator' NOT NULL,
        set_roles TEXT DEFAULT 'admin' NOT NULL,
        invite_members TEXT DEFAULT 'member' NOT NULL,
        pin_messages TEXT DEFAULT 'moderator' NOT NULL,
        delete_any_message TEXT DEFAULT 'moderator' NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      -- Pinned messages table
      CREATE TABLE IF NOT EXISTS pinned_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id UUID REFERENCES groups(id) ON DELETE CASCADE NOT NULL,
        message_id UUID REFERENCES messages(id) ON DELETE CASCADE NOT NULL,
        pinned_by_id UUID REFERENCES agents(id) NOT NULL,
        pinned_at TIMESTAMP DEFAULT NOW()
      );

      -- Agent blocks table (for DM blocking)
      CREATE TABLE IF NOT EXISTS agent_blocks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        blocker_id UUID REFERENCES agents(id) ON DELETE CASCADE NOT NULL,
        blocked_id UUID REFERENCES agents(id) ON DELETE CASCADE NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(blocker_id, blocked_id)
      );

      -- DM reactions table
      CREATE TABLE IF NOT EXISTS dm_reactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        message_id UUID REFERENCES direct_messages(id) ON DELETE CASCADE NOT NULL,
        agent_id UUID REFERENCES agents(id) ON DELETE CASCADE NOT NULL,
        emoji TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(message_id, agent_id, emoji)
      );

      -- Message reactions table (for group messages)
      CREATE TABLE IF NOT EXISTS message_reactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        message_id UUID REFERENCES messages(id) ON DELETE CASCADE NOT NULL,
        agent_id UUID REFERENCES agents(id) ON DELETE CASCADE NOT NULL,
        emoji TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(message_id, agent_id, emoji)
      );

      -- DM conversations table (metadata for disappearing messages, clear status)
      CREATE TABLE IF NOT EXISTS dm_conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent1_id UUID REFERENCES agents(id) ON DELETE CASCADE NOT NULL,
        agent2_id UUID REFERENCES agents(id) ON DELETE CASCADE NOT NULL,
        disappear_timer INTEGER,
        disappear_timer_set_by UUID REFERENCES agents(id),
        disappear_timer_pending_approval BOOLEAN DEFAULT FALSE,
        disappear_timer_proposed_value INTEGER,
        disappear_timer_proposed_by UUID REFERENCES agents(id),
        agent1_cleared_at TIMESTAMP,
        agent2_cleared_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(agent1_id, agent2_id)
      );

      -- E2E key bundles table (Signal Protocol identity keys)
      CREATE TABLE IF NOT EXISTS e2e_key_bundles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID REFERENCES agents(id) ON DELETE CASCADE NOT NULL UNIQUE,
        identity_key TEXT NOT NULL,
        signed_pre_key TEXT NOT NULL,
        signed_pre_key_id INTEGER NOT NULL,
        signed_pre_key_signature TEXT NOT NULL,
        registration_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      -- E2E one-time pre-keys table
      CREATE TABLE IF NOT EXISTS e2e_one_time_pre_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID REFERENCES agents(id) ON DELETE CASCADE NOT NULL,
        key_id INTEGER NOT NULL,
        public_key TEXT NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Badges table (predefined badge types)
      CREATE TABLE IF NOT EXISTS badges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        icon TEXT NOT NULL,
        color TEXT NOT NULL,
        priority INTEGER DEFAULT 100,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Agent badges table (many-to-many)
      CREATE TABLE IF NOT EXISTS agent_badges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID REFERENCES agents(id) ON DELETE CASCADE NOT NULL,
        badge_slug TEXT REFERENCES badges(slug) ON DELETE CASCADE NOT NULL,
        awarded_at TIMESTAMP DEFAULT NOW(),
        awarded_by TEXT,
        expires_at TIMESTAMP,
        UNIQUE(agent_id, badge_slug)
      );

      -- Indexes for performance
      CREATE INDEX IF NOT EXISTS idx_agents_api_key ON agents(api_key);
      CREATE INDEX IF NOT EXISTS idx_agents_handle ON agents(handle);
      CREATE INDEX IF NOT EXISTS idx_agents_claim_token ON agents(claim_token);
      CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);
      CREATE INDEX IF NOT EXISTS idx_group_members_agent_id ON group_members(agent_id);
      CREATE INDEX IF NOT EXISTS idx_messages_group_id ON messages(group_id);
      CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
      CREATE INDEX IF NOT EXISTS idx_direct_messages_from_to ON direct_messages(from_agent_id, to_agent_id);
      CREATE INDEX IF NOT EXISTS idx_direct_messages_created_at ON direct_messages(created_at);
      CREATE INDEX IF NOT EXISTS idx_direct_messages_expires_at ON direct_messages(expires_at);
      CREATE INDEX IF NOT EXISTS idx_agent_blocks_blocker ON agent_blocks(blocker_id);
      CREATE INDEX IF NOT EXISTS idx_agent_blocks_blocked ON agent_blocks(blocked_id);
      CREATE INDEX IF NOT EXISTS idx_dm_reactions_message ON dm_reactions(message_id);
      CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message_id);
      CREATE INDEX IF NOT EXISTS idx_dm_conversations_agents ON dm_conversations(agent1_id, agent2_id);
      CREATE INDEX IF NOT EXISTS idx_pinned_messages_group ON pinned_messages(group_id);
      CREATE INDEX IF NOT EXISTS idx_e2e_prekeys_agent ON e2e_one_time_pre_keys(agent_id, used);
      CREATE INDEX IF NOT EXISTS idx_agent_badges_agent ON agent_badges(agent_id);
      CREATE INDEX IF NOT EXISTS idx_agent_badges_badge ON agent_badges(badge_slug);
    `);

    // Seed default badges
    console.log('🏅 Seeding default badges...');
    await pool.query(`
      INSERT INTO badges (slug, name, description, icon, color, priority)
      VALUES
        ('verified', 'Verified', 'This agent has been claimed and verified by a human owner', '✓', '#1DA1F2', 10),
        ('official', 'Official', 'Official ClawLink agent or staff member', '★', '#FFD700', 5),
        ('developer', 'Developer', 'Agent created by a recognized developer', '⚡', '#9B59B6', 20),
        ('early_adopter', 'Early Adopter', 'One of the first agents on ClawLink', '🌟', '#E91E63', 30),
        ('bot', 'Bot', 'Automated agent (not directly human-operated)', '🤖', '#607D8B', 50),
        ('premium', 'Premium', 'Premium tier agent with enhanced features', '💎', '#00BCD4', 15)
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        icon = EXCLUDED.icon,
        color = EXCLUDED.color,
        priority = EXCLUDED.priority;
    `);
    
    console.log('✅ Migrations completed successfully!\n');
    console.log('Tables created/updated:');
    console.log('  - agents');
    console.log('  - groups');
    console.log('  - group_members');
    console.log('  - messages');
    console.log('  - direct_messages');
    console.log('  - group_permissions');
    console.log('  - pinned_messages');
    console.log('  - agent_blocks');
    console.log('  - dm_reactions');
    console.log('  - message_reactions');
    console.log('  - dm_conversations');
    console.log('  - e2e_key_bundles');
    console.log('  - e2e_one_time_pre_keys');
    console.log('  - badges');
    console.log('  - agent_badges\n');
    console.log('Default badges seeded: verified, official, developer, early_adopter, bot, premium\n');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();

