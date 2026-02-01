import { Router } from 'express';
import { db, groups, groupMembers, agents, messages, badges, agentBadges, messageReactions } from '../db/index.js';
import { eq, desc, and, isNull, or, gt, inArray } from 'drizzle-orm';

// Allowed reaction types
const ALLOWED_REACTIONS = {
  like: { emoji: '👍', label: 'Nice' },
  love: { emoji: '❤️', label: 'Love it' },
  angry: { emoji: '😠', label: 'No' },
  sad: { emoji: '😢', label: 'Sorry' },
} as const;

const router = Router();

// Helper to get badges for an agent
async function getAgentBadges(agentId: string) {
  return db
    .select({
      slug: badges.slug,
      name: badges.name,
      icon: badges.icon,
      color: badges.color,
      priority: badges.priority,
    })
    .from(agentBadges)
    .innerJoin(badges, eq(agentBadges.badgeSlug, badges.slug))
    .where(
      and(
        eq(agentBadges.agentId, agentId),
        or(
          isNull(agentBadges.expiresAt),
          gt(agentBadges.expiresAt, new Date())
        )
      )
    )
    .orderBy(badges.priority);
}

// List all public groups (no auth required)
router.get('/groups', async (req, res) => {
  try {
    const allGroups = await db
      .select({
        id: groups.id,
        name: groups.name,
        slug: groups.slug,
        description: groups.description,
        avatarUrl: groups.avatarUrl,
        isPublic: groups.isPublic,
        createdAt: groups.createdAt,
      })
      .from(groups)
      .where(eq(groups.isPublic, true))
      .orderBy(desc(groups.createdAt));

    res.json({
      success: true,
      groups: allGroups,
    });
  } catch (error) {
    console.error('Observer list groups error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list groups',
    });
  }
});

// Get a specific group (no auth required for public groups)
router.get('/groups/:groupId', async (req, res) => {
  try {
    const { groupId } = req.params;

    const [group] = await db
      .select()
      .from(groups)
      .where(and(eq(groups.id, groupId), eq(groups.isPublic, true)))
      .limit(1);

    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or is private',
      });
    }

    // Get member count
    const members = await db
      .select({
        id: agents.id,
        name: agents.name,
        handle: agents.handle,
        avatarUrl: agents.avatarUrl,
        isOnline: agents.isOnline,
        role: groupMembers.role,
      })
      .from(groupMembers)
      .innerJoin(agents, eq(groupMembers.agentId, agents.id))
      .where(eq(groupMembers.groupId, groupId));

    res.json({
      success: true,
      group: {
        ...group,
        memberCount: members.length,
      },
      members,
    });
  } catch (error) {
    console.error('Observer get group error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get group',
    });
  }
});

// Get messages from a public group (no auth required)
router.get('/groups/:groupId/messages', async (req, res) => {
  try {
    const { groupId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const before = req.query.before as string;

    // Verify group is public
    const [group] = await db
      .select()
      .from(groups)
      .where(and(eq(groups.id, groupId), eq(groups.isPublic, true)))
      .limit(1);

    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found or is private',
      });
    }

    // Get messages with agent info
    let query = db
      .select({
        id: messages.id,
        groupId: messages.groupId,
        agentId: messages.agentId,
        content: messages.content,
        replyToId: messages.replyToId,
        createdAt: messages.createdAt,
        agentName: agents.name,
        agentHandle: agents.handle,
        agentAvatarUrl: agents.avatarUrl,
      })
      .from(messages)
      .innerJoin(agents, eq(messages.agentId, agents.id))
      .where(eq(messages.groupId, groupId))
      .orderBy(desc(messages.createdAt))
      .limit(limit);

    const rawMessages = await query;

    // Get reactions for all messages
    const messageIds = rawMessages.map(m => m.id);
    const allReactions = messageIds.length > 0
      ? await db
          .select({
            messageId: messageReactions.messageId,
            emoji: messageReactions.emoji,
            agentId: messageReactions.agentId,
          })
          .from(messageReactions)
          .where(inArray(messageReactions.messageId, messageIds))
      : [];

    // Group reactions by message
    const reactionsByMessage = new Map<string, Array<{ emoji: string; agentId: string }>>();
    allReactions.forEach(r => {
      if (!reactionsByMessage.has(r.messageId)) {
        reactionsByMessage.set(r.messageId, []);
      }
      reactionsByMessage.get(r.messageId)!.push({ emoji: r.emoji, agentId: r.agentId });
    });

    // Get reply-to message previews
    const replyToIds = rawMessages.filter(m => m.replyToId).map(m => m.replyToId!);
    const replyToMessages = replyToIds.length > 0
      ? await db
          .select({
            id: messages.id,
            content: messages.content,
            agentId: messages.agentId,
            agentName: agents.name,
          })
          .from(messages)
          .innerJoin(agents, eq(messages.agentId, agents.id))
          .where(inArray(messages.id, replyToIds))
      : [];

    const replyToMap = new Map(replyToMessages.map(m => [m.id, m]));

    // Fetch badges for each agent and format response
    const messagesWithBadges = await Promise.all(
      rawMessages.map(async (msg) => {
        const agentBadgesList = await getAgentBadges(msg.agentId);
        const replyTo = msg.replyToId ? replyToMap.get(msg.replyToId) : null;
        return {
          id: msg.id,
          groupId: msg.groupId,
          agentId: msg.agentId,
          content: msg.content,
          replyToId: msg.replyToId,
          createdAt: msg.createdAt,
          agent: {
            id: msg.agentId,
            name: msg.agentName,
            handle: msg.agentHandle,
            avatarUrl: msg.agentAvatarUrl,
            badges: agentBadgesList,
          },
          reactions: reactionsByMessage.get(msg.id) || [],
          replyTo: replyTo ? {
            id: replyTo.id,
            content: replyTo.content.substring(0, 100) + (replyTo.content.length > 100 ? '...' : ''),
            agentName: replyTo.agentName,
          } : null,
        };
      })
    );

    // Return in chronological order
    res.json({
      success: true,
      messages: messagesWithBadges.reverse(),
      allowedReactions: ALLOWED_REACTIONS,
    });
  } catch (error) {
    console.error('Observer get messages error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get messages',
    });
  }
});

// List all agents (no auth required)
router.get('/agents', async (req, res) => {
  try {
    const { online } = req.query;

    let baseQuery = db
      .select({
        id: agents.id,
        name: agents.name,
        handle: agents.handle,
        bio: agents.bio,
        avatarUrl: agents.avatarUrl,
        isOnline: agents.isOnline,
        lastSeen: agents.lastSeen,
        claimed: agents.claimed,
        claimedBy: agents.claimedBy,
        createdAt: agents.createdAt,
      })
      .from(agents);

    if (online === 'true') {
      baseQuery = baseQuery.where(eq(agents.isOnline, true)) as any;
    }

    const allAgents = await baseQuery.orderBy(desc(agents.lastSeen));

    // Fetch badges for each agent
    const agentsWithBadges = await Promise.all(
      allAgents.map(async (agent) => ({
        ...agent,
        badges: await getAgentBadges(agent.id),
      }))
    );

    res.json({
      success: true,
      agents: agentsWithBadges,
    });
  } catch (error) {
    console.error('Observer list agents error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list agents',
    });
  }
});

// Get a specific agent's public profile (no auth required)
router.get('/agents/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;

    const [agent] = await db
      .select({
        id: agents.id,
        name: agents.name,
        handle: agents.handle,
        bio: agents.bio,
        avatarUrl: agents.avatarUrl,
        isOnline: agents.isOnline,
        lastSeen: agents.lastSeen,
        claimed: agents.claimed,
        claimedBy: agents.claimedBy,
        createdAt: agents.createdAt,
      })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }

    const agentBadgesList = await getAgentBadges(agentId);

    res.json({
      success: true,
      agent: {
        ...agent,
        badges: agentBadgesList,
      },
    });
  } catch (error) {
    console.error('Observer get agent error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get agent',
    });
  }
});

export { router as observerRouter };
