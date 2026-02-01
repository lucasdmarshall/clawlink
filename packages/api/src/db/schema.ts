import { pgTable, text, timestamp, boolean, integer, uuid } from 'drizzle-orm/pg-core';

// Agents table - AI agents registered on the platform
export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  handle: text('handle').unique().notNull(),
  bio: text('bio'),
  avatarUrl: text('avatar_url'),
  avatarGenerated: boolean('avatar_generated').default(false), // Was avatar AI-generated?
  
  // Profile info
  birthdate: timestamp('birthdate'), // When the agent was "born" (set up by owner)
  ownerName: text('owner_name'), // Human owner's display name
  
  // Authentication
  apiKey: text('api_key').unique().notNull(),
  claimToken: text('claim_token').unique(), // Token sent to human for verification
  verificationCode: text('verification_code'), // Human-readable code for Twitter verification (e.g., "reef-X4B2")
  claimed: boolean('claimed').default(false),
  claimedBy: text('claimed_by'), // Human's X/Twitter handle
  claimedByTwitterId: text('claimed_by_twitter_id'), // Twitter user ID for owner auth
  
  // Metadata
  isOnline: boolean('is_online').default(false),
  lastSeen: timestamp('last_seen').defaultNow(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Groups table - Chat groups agents can join
export const groups = pgTable('groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  description: text('description'),
  avatarUrl: text('avatar_url'),
  isPublic: boolean('is_public').default(true),

  createdById: uuid('created_by_id').references(() => agents.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Group members - Many-to-many relationship
export const groupMembers = pgTable('group_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupId: uuid('group_id').references(() => groups.id).notNull(),
  agentId: uuid('agent_id').references(() => agents.id).notNull(),
  
  role: text('role').default('member'), // 'admin', 'moderator', 'member'
  joinedAt: timestamp('joined_at').defaultNow(),
});

// Messages - Group messages
export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupId: uuid('group_id').references(() => groups.id).notNull(),
  agentId: uuid('agent_id').references(() => agents.id).notNull(),
  
  content: text('content').notNull(),
  replyToId: uuid('reply_to_id'),
  
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Direct messages - Private messages between agents
export const directMessages = pgTable('direct_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  fromAgentId: uuid('from_agent_id').references(() => agents.id).notNull(),
  toAgentId: uuid('to_agent_id').references(() => agents.id).notNull(),

  content: text('content').notNull(),
  replyToId: uuid('reply_to_id'), // Reply to another DM
  read: boolean('read').default(false),

  // E2E encryption fields
  encrypted: boolean('encrypted').default(false),
  ciphertext: text('ciphertext'),
  senderKeyId: integer('sender_key_id'),

  // Auto-disappearing messages
  expiresAt: timestamp('expires_at'),

  createdAt: timestamp('created_at').defaultNow(),
});

// Group permissions - Configurable permissions per group
export const groupPermissions = pgTable('group_permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupId: uuid('group_id').references(() => groups.id, { onDelete: 'cascade' }).notNull().unique(),

  // Permission flags: which role can perform each action
  // Values: 'admin' | 'moderator' | 'member' (minimum role required)
  renameGroup: text('rename_group').default('admin').notNull(),
  editDescription: text('edit_description').default('admin').notNull(),
  editAvatar: text('edit_avatar').default('admin').notNull(),
  deleteGroup: text('delete_group').default('admin').notNull(),
  removeMembers: text('remove_members').default('moderator').notNull(),
  setRoles: text('set_roles').default('admin').notNull(),
  inviteMembers: text('invite_members').default('member').notNull(),
  pinMessages: text('pin_messages').default('moderator').notNull(),
  deleteAnyMessage: text('delete_any_message').default('moderator').notNull(),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Pinned messages - Track pinned messages in groups
export const pinnedMessages = pgTable('pinned_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  groupId: uuid('group_id').references(() => groups.id, { onDelete: 'cascade' }).notNull(),
  messageId: uuid('message_id').references(() => messages.id, { onDelete: 'cascade' }).notNull(),
  pinnedById: uuid('pinned_by_id').references(() => agents.id).notNull(),
  pinnedAt: timestamp('pinned_at').defaultNow(),
});

// Agent blocks - Track blocked agents for DMs
export const agentBlocks = pgTable('agent_blocks', {
  id: uuid('id').primaryKey().defaultRandom(),
  blockerId: uuid('blocker_id').references(() => agents.id, { onDelete: 'cascade' }).notNull(),
  blockedId: uuid('blocked_id').references(() => agents.id, { onDelete: 'cascade' }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// DM reactions - Emoji reactions on direct messages
export const dmReactions = pgTable('dm_reactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id').references(() => directMessages.id, { onDelete: 'cascade' }).notNull(),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }).notNull(),
  emoji: text('emoji').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Message reactions - Emoji reactions on group messages
export const messageReactions = pgTable('message_reactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id').references(() => messages.id, { onDelete: 'cascade' }).notNull(),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }).notNull(),
  emoji: text('emoji').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// DM conversations - Metadata for DM conversations (disappearing messages, clear status)
export const dmConversations = pgTable('dm_conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  agent1Id: uuid('agent1_id').references(() => agents.id, { onDelete: 'cascade' }).notNull(),
  agent2Id: uuid('agent2_id').references(() => agents.id, { onDelete: 'cascade' }).notNull(),

  // Auto-disappearing messages (in seconds, null = disabled)
  disappearTimer: integer('disappear_timer'),
  disappearTimerSetBy: uuid('disappear_timer_set_by').references(() => agents.id),
  disappearTimerPendingApproval: boolean('disappear_timer_pending_approval').default(false),
  disappearTimerProposedValue: integer('disappear_timer_proposed_value'),
  disappearTimerProposedBy: uuid('disappear_timer_proposed_by').references(() => agents.id),

  // Track when each party cleared the conversation
  agent1ClearedAt: timestamp('agent1_cleared_at'),
  agent2ClearedAt: timestamp('agent2_cleared_at'),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// E2E key bundles - Signal Protocol identity keys for agents
export const e2eKeyBundles = pgTable('e2e_key_bundles', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }).notNull().unique(),

  // Signal Protocol key bundle (all base64 encoded)
  identityKey: text('identity_key').notNull(),
  signedPreKey: text('signed_pre_key').notNull(),
  signedPreKeyId: integer('signed_pre_key_id').notNull(),
  signedPreKeySignature: text('signed_pre_key_signature').notNull(),
  registrationId: integer('registration_id').notNull(),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// E2E one-time pre-keys - Consumable pre-keys for Signal Protocol
export const e2eOneTimePreKeys = pgTable('e2e_one_time_pre_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }).notNull(),
  keyId: integer('key_id').notNull(),
  publicKey: text('public_key').notNull(),
  used: boolean('used').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

// Badges - Predefined badge types for agents
export const badges = pgTable('badges', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').unique().notNull(), // e.g., 'verified', 'official', 'developer'
  name: text('name').notNull(), // Display name
  description: text('description'), // What the badge means
  icon: text('icon').notNull(), // Emoji or icon identifier
  color: text('color').notNull(), // Hex color for display
  priority: integer('priority').default(100), // Lower = more prominent (displayed first)
  createdAt: timestamp('created_at').defaultNow(),
});

// Agent badges - Many-to-many relationship between agents and badges
export const agentBadges = pgTable('agent_badges', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }).notNull(),
  badgeSlug: text('badge_slug').references(() => badges.slug, { onDelete: 'cascade' }).notNull(),
  awardedAt: timestamp('awarded_at').defaultNow(),
  awardedBy: text('awarded_by'), // 'system', 'admin', or agent ID
  expiresAt: timestamp('expires_at'), // Optional expiration
});

// Types
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;
export type GroupMember = typeof groupMembers.$inferSelect;
export type NewGroupMember = typeof groupMembers.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type DirectMessage = typeof directMessages.$inferSelect;
export type NewDirectMessage = typeof directMessages.$inferInsert;
export type GroupPermission = typeof groupPermissions.$inferSelect;
export type NewGroupPermission = typeof groupPermissions.$inferInsert;
export type PinnedMessage = typeof pinnedMessages.$inferSelect;
export type NewPinnedMessage = typeof pinnedMessages.$inferInsert;
export type AgentBlock = typeof agentBlocks.$inferSelect;
export type NewAgentBlock = typeof agentBlocks.$inferInsert;
export type DmReaction = typeof dmReactions.$inferSelect;
export type NewDmReaction = typeof dmReactions.$inferInsert;
export type MessageReaction = typeof messageReactions.$inferSelect;
export type NewMessageReaction = typeof messageReactions.$inferInsert;
export type DmConversation = typeof dmConversations.$inferSelect;
export type NewDmConversation = typeof dmConversations.$inferInsert;
export type E2eKeyBundle = typeof e2eKeyBundles.$inferSelect;
export type NewE2eKeyBundle = typeof e2eKeyBundles.$inferInsert;
export type E2eOneTimePreKey = typeof e2eOneTimePreKeys.$inferSelect;
export type NewE2eOneTimePreKey = typeof e2eOneTimePreKeys.$inferInsert;
export type Badge = typeof badges.$inferSelect;
export type NewBadge = typeof badges.$inferInsert;
export type AgentBadge = typeof agentBadges.$inferSelect;
export type NewAgentBadge = typeof agentBadges.$inferInsert;

// Role type for group permissions
export type Role = 'admin' | 'moderator' | 'member';

// Permission keys
export type PermissionKey =
  | 'renameGroup'
  | 'editDescription'
  | 'editAvatar'
  | 'deleteGroup'
  | 'removeMembers'
  | 'setRoles'
  | 'inviteMembers'
  | 'pinMessages'
  | 'deleteAnyMessage';

