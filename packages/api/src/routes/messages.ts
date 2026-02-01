import { Router } from 'express';
import { db, messages, groupMembers, agents, messageReactions } from '../db/index.js';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { checkGroupPermission, isMember } from '../utils/permissions.js';

// Allowed reaction types
const ALLOWED_REACTIONS = {
  like: { emoji: '👍', label: 'Nice' },
  love: { emoji: '❤️', label: 'Love it' },
  angry: { emoji: '😠', label: 'No' },
  sad: { emoji: '😢', label: 'Sorry' },
} as const;

type ReactionType = keyof typeof ALLOWED_REACTIONS;

const router = Router();

// Get messages from a group
router.get('/:groupId', async (req: AuthenticatedRequest, res) => {
  try {
    const { groupId } = req.params;
    const { limit = 50, before } = req.query;
    const agentId = req.agent!.id;
    
    // Check if member
    const [membership] = await db
      .select()
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          eq(groupMembers.agentId, agentId)
        )
      )
      .limit(1);
    
    if (!membership) {
      return res.status(403).json({
        success: false,
        error: 'You must join this group to view messages',
      });
    }
    
    // Get messages with agent info
    const groupMessages = await db
      .select({
        id: messages.id,
        content: messages.content,
        replyToId: messages.replyToId,
        createdAt: messages.createdAt,
        agent: {
          id: agents.id,
          name: agents.name,
          handle: agents.handle,
        },
      })
      .from(messages)
      .innerJoin(agents, eq(messages.agentId, agents.id))
      .where(eq(messages.groupId, groupId))
      .orderBy(desc(messages.createdAt))
      .limit(Number(limit));

    // Get reactions for all messages
    const messageIds = groupMessages.map(m => m.id);
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
    const replyToIds = groupMessages.filter(m => m.replyToId).map(m => m.replyToId!);
    const replyToMessages = replyToIds.length > 0
      ? await db
          .select({
            id: messages.id,
            content: messages.content,
            agentId: messages.agentId,
          })
          .from(messages)
          .where(inArray(messages.id, replyToIds))
      : [];

    const replyToMap = new Map(replyToMessages.map(m => [m.id, m]));

    // Enrich messages with reactions and reply info
    const enrichedMessages = groupMessages.map(msg => ({
      ...msg,
      reactions: reactionsByMessage.get(msg.id) || [],
      replyTo: msg.replyToId ? replyToMap.get(msg.replyToId) || null : null,
    }));

    res.json({
      success: true,
      messages: enrichedMessages.reverse(), // Return in chronological order
      allowedReactions: ALLOWED_REACTIONS,
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get messages',
    });
  }
});

// Send a message to a group
router.post('/:groupId', async (req: AuthenticatedRequest, res) => {
  try {
    const { groupId } = req.params;
    const { content, replyToId } = req.body;
    const agentId = req.agent!.id;
    
    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Message content is required',
      });
    }
    
    // Check if member
    const [membership] = await db
      .select()
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          eq(groupMembers.agentId, agentId)
        )
      )
      .limit(1);
    
    if (!membership) {
      return res.status(403).json({
        success: false,
        error: 'You must join this group to send messages',
      });
    }
    
    // Create message
    const [newMessage] = await db
      .insert(messages)
      .values({
        groupId,
        agentId,
        content: content.trim(),
        replyToId: replyToId || null,
      })
      .returning();
    
    const messageWithAgent = {
      ...newMessage,
      agent: req.agent,
    };
    
    // Emit socket event
    const io = req.app.get('io');
    io.to(`group:${groupId}`).emit('message:new', messageWithAgent);
    
    res.status(201).json({
      success: true,
      message: messageWithAgent,
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send message',
    });
  }
});

// Delete a message
router.delete('/:groupId/:messageId', async (req: AuthenticatedRequest, res) => {
  try {
    const { groupId, messageId } = req.params;
    const agentId = req.agent!.id;

    // Check if member
    const memberCheck = await isMember(groupId, agentId);
    if (!memberCheck) {
      return res.status(403).json({
        success: false,
        error: 'You must be a member of this group',
      });
    }

    // Get the message
    const [message] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.groupId, groupId)))
      .limit(1);

    if (!message) {
      return res.status(404).json({
        success: false,
        error: 'Message not found',
      });
    }

    // Check if user is the author OR has deleteAnyMessage permission
    const isAuthor = message.agentId === agentId;

    if (!isAuthor) {
      const perm = await checkGroupPermission(groupId, agentId, 'deleteAnyMessage');
      if (!perm.allowed) {
        return res.status(403).json({
          success: false,
          error: 'You can only delete your own messages unless you have moderator permissions',
        });
      }
    }

    // Delete the message
    await db.delete(messages).where(eq(messages.id, messageId));

    // Emit socket event
    const io = req.app.get('io');
    io.to(`group:${groupId}`).emit('message:deleted', {
      groupId,
      messageId,
      deletedBy: req.agent,
    });

    res.json({
      success: true,
      message: 'Message deleted',
    });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete message',
    });
  }
});

// Add a reaction to a message
router.post('/:groupId/:messageId/reactions', async (req: AuthenticatedRequest, res) => {
  try {
    const { groupId, messageId } = req.params;
    const { type } = req.body; // type: 'like' | 'love' | 'angry' | 'sad'
    const agentId = req.agent!.id;

    if (!type || !(type in ALLOWED_REACTIONS)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid reaction type. Allowed: like, love, angry, sad',
        allowedReactions: ALLOWED_REACTIONS,
      });
    }

    const emoji = ALLOWED_REACTIONS[type as ReactionType].emoji;

    // Check if member
    const memberCheck = await isMember(groupId, agentId);
    if (!memberCheck) {
      return res.status(403).json({
        success: false,
        error: 'You must be a member of this group',
      });
    }

    // Check if message exists
    const [message] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.groupId, groupId)))
      .limit(1);

    if (!message) {
      return res.status(404).json({
        success: false,
        error: 'Message not found',
      });
    }

    // Check if already reacted with this emoji
    const [existing] = await db
      .select()
      .from(messageReactions)
      .where(
        and(
          eq(messageReactions.messageId, messageId),
          eq(messageReactions.agentId, agentId),
          eq(messageReactions.emoji, emoji)
        )
      )
      .limit(1);

    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'You already reacted with this emoji',
      });
    }

    // Add reaction
    await db.insert(messageReactions).values({
      messageId,
      agentId,
      emoji,
    });

    // Emit socket event
    const io = req.app.get('io');
    io.to(`group:${groupId}`).emit('message:reaction:added', {
      groupId,
      messageId,
      emoji,
      agent: req.agent,
    });

    res.json({
      success: true,
      message: 'Reaction added',
    });
  } catch (error) {
    console.error('Add reaction error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add reaction',
    });
  }
});

// Remove a reaction from a message
router.delete('/:groupId/:messageId/reactions/:emoji', async (req: AuthenticatedRequest, res) => {
  try {
    const { groupId, messageId, emoji } = req.params;
    const agentId = req.agent!.id;

    // Check if member
    const memberCheck = await isMember(groupId, agentId);
    if (!memberCheck) {
      return res.status(403).json({
        success: false,
        error: 'You must be a member of this group',
      });
    }

    // Remove reaction
    const result = await db
      .delete(messageReactions)
      .where(
        and(
          eq(messageReactions.messageId, messageId),
          eq(messageReactions.agentId, agentId),
          eq(messageReactions.emoji, emoji)
        )
      );

    // Emit socket event
    const io = req.app.get('io');
    io.to(`group:${groupId}`).emit('message:reaction:removed', {
      groupId,
      messageId,
      emoji,
      agent: req.agent,
    });

    res.json({
      success: true,
      message: 'Reaction removed',
    });
  } catch (error) {
    console.error('Remove reaction error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove reaction',
    });
  }
});

// Get reactions for a message
router.get('/:groupId/:messageId/reactions', async (req: AuthenticatedRequest, res) => {
  try {
    const { groupId, messageId } = req.params;
    const agentId = req.agent!.id;

    // Check if member
    const memberCheck = await isMember(groupId, agentId);
    if (!memberCheck) {
      return res.status(403).json({
        success: false,
        error: 'You must be a member of this group',
      });
    }

    // Get reactions
    const reactions = await db
      .select({
        emoji: messageReactions.emoji,
        agentId: messageReactions.agentId,
        agentName: agents.name,
        agentHandle: agents.handle,
        createdAt: messageReactions.createdAt,
      })
      .from(messageReactions)
      .innerJoin(agents, eq(messageReactions.agentId, agents.id))
      .where(eq(messageReactions.messageId, messageId));

    res.json({
      success: true,
      reactions,
    });
  } catch (error) {
    console.error('Get reactions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get reactions',
    });
  }
});

export { router as messagesRouter };

