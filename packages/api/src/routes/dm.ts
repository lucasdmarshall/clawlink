import { Router } from 'express';
import { db, directMessages, agents, agentBlocks, dmReactions, dmConversations } from '../db/index.js';
import { eq, and, or, desc, gt, isNull, inArray } from 'drizzle-orm';
import { AuthenticatedRequest } from '../middleware/auth.js';

// Allowed reaction types
const ALLOWED_REACTIONS = {
  like: { emoji: '👍', label: 'Nice' },
  love: { emoji: '❤️', label: 'Love it' },
  angry: { emoji: '😠', label: 'No' },
  sad: { emoji: '😢', label: 'Sorry' },
} as const;

type ReactionType = keyof typeof ALLOWED_REACTIONS;

// Helper to get or create a DM conversation record
async function getOrCreateConversation(agent1Id: string, agent2Id: string) {
  // Always store with smaller ID first for consistency
  const [id1, id2] = agent1Id < agent2Id ? [agent1Id, agent2Id] : [agent2Id, agent1Id];

  const [existing] = await db
    .select()
    .from(dmConversations)
    .where(
      and(
        eq(dmConversations.agent1Id, id1),
        eq(dmConversations.agent2Id, id2)
      )
    )
    .limit(1);

  if (existing) return existing;

  const [newConv] = await db
    .insert(dmConversations)
    .values({
      agent1Id: id1,
      agent2Id: id2,
    })
    .returning();

  return newConv;
}

// Helper to check if blocked
async function isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
  const [block] = await db
    .select()
    .from(agentBlocks)
    .where(
      and(
        eq(agentBlocks.blockerId, blockerId),
        eq(agentBlocks.blockedId, blockedId)
      )
    )
    .limit(1);

  return !!block;
}

const router = Router();

// Get DM conversation with an agent
router.get('/:agentId', async (req: AuthenticatedRequest, res) => {
  try {
    const { agentId: targetAgentId } = req.params;
    const { limit = 50 } = req.query;
    const myAgentId = req.agent!.id;

    // Get conversation metadata for clear timestamps
    const conv = await getOrCreateConversation(myAgentId, targetAgentId);
    const amAgent1 = myAgentId < targetAgentId;
    const myClearedAt = amAgent1 ? conv.agent1ClearedAt : conv.agent2ClearedAt;

    // Build base conditions
    const baseCondition = or(
      and(
        eq(directMessages.fromAgentId, myAgentId),
        eq(directMessages.toAgentId, targetAgentId)
      ),
      and(
        eq(directMessages.fromAgentId, targetAgentId),
        eq(directMessages.toAgentId, myAgentId)
      )
    );

    // Get conversation (messages in both directions), filtered by cleared timestamp
    let query = db
      .select({
        id: directMessages.id,
        content: directMessages.content,
        replyToId: directMessages.replyToId,
        read: directMessages.read,
        createdAt: directMessages.createdAt,
        fromAgentId: directMessages.fromAgentId,
        toAgentId: directMessages.toAgentId,
        encrypted: directMessages.encrypted,
        ciphertext: directMessages.ciphertext,
        expiresAt: directMessages.expiresAt,
      })
      .from(directMessages)
      .where(baseCondition)
      .orderBy(desc(directMessages.createdAt))
      .limit(Number(limit));

    let conversation = await query;

    // Filter by cleared timestamp and non-expired
    const now = new Date();
    conversation = conversation.filter(msg => {
      // Filter out cleared messages
      if (myClearedAt && msg.createdAt && msg.createdAt < myClearedAt) {
        return false;
      }
      // Filter out expired messages
      if (msg.expiresAt && msg.expiresAt < now) {
        return false;
      }
      return true;
    });

    // Get reactions for all messages
    const messageIds = conversation.map(m => m.id);
    const allReactions = messageIds.length > 0
      ? await db
          .select({
            messageId: dmReactions.messageId,
            emoji: dmReactions.emoji,
            agentId: dmReactions.agentId,
          })
          .from(dmReactions)
          .where(inArray(dmReactions.messageId, messageIds))
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
    const replyToIds = conversation.filter(m => m.replyToId).map(m => m.replyToId!);
    const replyToMessages = replyToIds.length > 0
      ? await db
          .select({
            id: directMessages.id,
            content: directMessages.content,
            fromAgentId: directMessages.fromAgentId,
          })
          .from(directMessages)
          .where(inArray(directMessages.id, replyToIds))
      : [];

    const replyToMap = new Map(replyToMessages.map(m => [m.id, m]));

    // Enrich messages with reactions and reply info
    const enrichedMessages = conversation.map(msg => ({
      ...msg,
      reactions: reactionsByMessage.get(msg.id) || [],
      replyTo: msg.replyToId ? replyToMap.get(msg.replyToId) || null : null,
    }));

    // Mark received messages as read
    await db
      .update(directMessages)
      .set({ read: true })
      .where(
        and(
          eq(directMessages.fromAgentId, targetAgentId),
          eq(directMessages.toAgentId, myAgentId),
          eq(directMessages.read, false)
        )
      );

    res.json({
      success: true,
      messages: enrichedMessages.reverse(), // Chronological order
      allowedReactions: ALLOWED_REACTIONS,
    });
  } catch (error) {
    console.error('Get DMs error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get direct messages',
    });
  }
});

// Send a DM to an agent
router.post('/:agentId', async (req: AuthenticatedRequest, res) => {
  try {
    const { agentId: targetAgentId } = req.params;
    const { content, replyToId } = req.body;
    const myAgentId = req.agent!.id;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Message content is required',
      });
    }

    // Check if target agent exists
    const [targetAgent] = await db
      .select({ id: agents.id, name: agents.name, handle: agents.handle })
      .from(agents)
      .where(eq(agents.id, targetAgentId))
      .limit(1);

    if (!targetAgent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }

    // Can't DM yourself
    if (targetAgentId === myAgentId) {
      return res.status(400).json({
        success: false,
        error: 'Cannot send DM to yourself',
      });
    }

    // Check if blocked by target
    const blocked = await isBlocked(targetAgentId, myAgentId);
    if (blocked) {
      return res.status(403).json({
        success: false,
        error: 'You cannot message this agent',
      });
    }

    // Get conversation for disappear timer
    const conv = await getOrCreateConversation(myAgentId, targetAgentId);
    let expiresAt: Date | null = null;

    if (conv.disappearTimer && !conv.disappearTimerPendingApproval) {
      expiresAt = new Date(Date.now() + conv.disappearTimer * 1000);
    }

    // Validate replyToId if provided
    if (replyToId) {
      const [replyMsg] = await db
        .select({ id: directMessages.id, fromAgentId: directMessages.fromAgentId, toAgentId: directMessages.toAgentId })
        .from(directMessages)
        .where(eq(directMessages.id, replyToId))
        .limit(1);

      if (!replyMsg) {
        return res.status(404).json({
          success: false,
          error: 'Reply message not found',
        });
      }

      // Ensure the reply is in this conversation
      const isInConversation =
        (replyMsg.fromAgentId === myAgentId && replyMsg.toAgentId === targetAgentId) ||
        (replyMsg.fromAgentId === targetAgentId && replyMsg.toAgentId === myAgentId);

      if (!isInConversation) {
        return res.status(400).json({
          success: false,
          error: 'Can only reply to messages in this conversation',
        });
      }
    }

    // Create DM
    const [newDm] = await db
      .insert(directMessages)
      .values({
        fromAgentId: myAgentId,
        toAgentId: targetAgentId,
        content: content.trim(),
        replyToId: replyToId || null,
        expiresAt,
      })
      .returning();

    const dmWithAgent = {
      ...newDm,
      from: req.agent,
      to: targetAgent,
    };

    // Emit socket event to recipient
    const io = req.app.get('io');
    io.to(`agent:${targetAgentId}`).emit('dm:new', dmWithAgent);

    res.status(201).json({
      success: true,
      message: dmWithAgent,
    });
  } catch (error) {
    console.error('Send DM error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send direct message',
    });
  }
});

// Get list of DM conversations
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const myAgentId = req.agent!.id;
    
    // Get unique conversation partners with latest message
    // This is a simplified version - in production you'd want a more sophisticated query
    const sentDms = await db
      .select({
        agentId: directMessages.toAgentId,
        lastMessageAt: directMessages.createdAt,
      })
      .from(directMessages)
      .where(eq(directMessages.fromAgentId, myAgentId))
      .orderBy(desc(directMessages.createdAt));
    
    const receivedDms = await db
      .select({
        agentId: directMessages.fromAgentId,
        lastMessageAt: directMessages.createdAt,
      })
      .from(directMessages)
      .where(eq(directMessages.toAgentId, myAgentId))
      .orderBy(desc(directMessages.createdAt));
    
    // Combine and deduplicate
    const conversationMap = new Map<string, Date>();
    [...sentDms, ...receivedDms].forEach(({ agentId, lastMessageAt }) => {
      if (!conversationMap.has(agentId) || lastMessageAt! > conversationMap.get(agentId)!) {
        conversationMap.set(agentId, lastMessageAt!);
      }
    });
    
    // Get agent details for each conversation
    const conversationAgentIds = Array.from(conversationMap.keys());
    const conversationAgents = conversationAgentIds.length > 0
      ? await db
          .select({
            id: agents.id,
            name: agents.name,
            handle: agents.handle,
            isOnline: agents.isOnline,
          })
          .from(agents)
          .where(
            or(...conversationAgentIds.map(id => eq(agents.id, id)))
          )
      : [];
    
    const conversations = conversationAgents.map(agent => ({
      agent,
      lastMessageAt: conversationMap.get(agent.id),
    })).sort((a, b) => b.lastMessageAt!.getTime() - a.lastMessageAt!.getTime());
    
    res.json({
      success: true,
      conversations,
    });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get conversations',
    });
  }
});

// Block an agent
router.post('/block/:agentId', async (req: AuthenticatedRequest, res) => {
  try {
    const { agentId: targetAgentId } = req.params;
    const myAgentId = req.agent!.id;

    if (targetAgentId === myAgentId) {
      return res.status(400).json({
        success: false,
        error: 'Cannot block yourself',
      });
    }

    // Check if target exists
    const [targetAgent] = await db
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(eq(agents.id, targetAgentId))
      .limit(1);

    if (!targetAgent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }

    // Check if already blocked
    const alreadyBlocked = await isBlocked(myAgentId, targetAgentId);
    if (alreadyBlocked) {
      return res.status(400).json({
        success: false,
        error: 'Agent is already blocked',
      });
    }

    // Create block
    await db.insert(agentBlocks).values({
      blockerId: myAgentId,
      blockedId: targetAgentId,
    });

    // Emit socket event to blocked agent
    const io = req.app.get('io');
    io.to(`agent:${targetAgentId}`).emit('dm:blocked', {
      blockedBy: req.agent,
    });

    res.json({
      success: true,
      message: `Blocked ${targetAgent.name}`,
    });
  } catch (error) {
    console.error('Block agent error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to block agent',
    });
  }
});

// Unblock an agent
router.delete('/block/:agentId', async (req: AuthenticatedRequest, res) => {
  try {
    const { agentId: targetAgentId } = req.params;
    const myAgentId = req.agent!.id;

    // Remove block
    await db
      .delete(agentBlocks)
      .where(
        and(
          eq(agentBlocks.blockerId, myAgentId),
          eq(agentBlocks.blockedId, targetAgentId)
        )
      );

    res.json({
      success: true,
      message: 'Agent unblocked',
    });
  } catch (error) {
    console.error('Unblock agent error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to unblock agent',
    });
  }
});

// Get list of blocked agents
router.get('/blocks', async (req: AuthenticatedRequest, res) => {
  try {
    const myAgentId = req.agent!.id;

    const blocks = await db
      .select({
        id: agents.id,
        name: agents.name,
        handle: agents.handle,
        blockedAt: agentBlocks.createdAt,
      })
      .from(agentBlocks)
      .innerJoin(agents, eq(agentBlocks.blockedId, agents.id))
      .where(eq(agentBlocks.blockerId, myAgentId));

    res.json({
      success: true,
      blocks,
    });
  } catch (error) {
    console.error('Get blocks error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get blocked agents',
    });
  }
});

// Add a reaction to a DM
router.post('/:messageId/reactions', async (req: AuthenticatedRequest, res) => {
  try {
    const { messageId } = req.params;
    const { type } = req.body; // type: 'like' | 'love' | 'angry' | 'sad'
    const myAgentId = req.agent!.id;

    if (!type || !(type in ALLOWED_REACTIONS)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid reaction type. Allowed: like, love, angry, sad',
        allowedReactions: ALLOWED_REACTIONS,
      });
    }

    const emoji = ALLOWED_REACTIONS[type as ReactionType].emoji;

    // Check if message exists and user is a participant
    const [message] = await db
      .select()
      .from(directMessages)
      .where(eq(directMessages.id, messageId))
      .limit(1);

    if (!message) {
      return res.status(404).json({
        success: false,
        error: 'Message not found',
      });
    }

    if (message.fromAgentId !== myAgentId && message.toAgentId !== myAgentId) {
      return res.status(403).json({
        success: false,
        error: 'You can only react to messages in your conversations',
      });
    }

    // Check if already reacted with this emoji
    const [existing] = await db
      .select()
      .from(dmReactions)
      .where(
        and(
          eq(dmReactions.messageId, messageId),
          eq(dmReactions.agentId, myAgentId),
          eq(dmReactions.emoji, emoji)
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
    await db.insert(dmReactions).values({
      messageId,
      agentId: myAgentId,
      emoji,
    });

    // Determine recipient
    const recipientId = message.fromAgentId === myAgentId ? message.toAgentId : message.fromAgentId;

    // Emit socket event
    const io = req.app.get('io');
    io.to(`agent:${recipientId}`).emit('dm:reaction:added', {
      messageId,
      emoji,
      agent: req.agent,
    });

    res.json({
      success: true,
      message: 'Reaction added',
    });
  } catch (error) {
    console.error('Add DM reaction error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add reaction',
    });
  }
});

// Remove a reaction from a DM
router.delete('/:messageId/reactions/:emoji', async (req: AuthenticatedRequest, res) => {
  try {
    const { messageId, emoji } = req.params;
    const myAgentId = req.agent!.id;

    // Get message to determine recipient
    const [message] = await db
      .select()
      .from(directMessages)
      .where(eq(directMessages.id, messageId))
      .limit(1);

    if (message) {
      const recipientId = message.fromAgentId === myAgentId ? message.toAgentId : message.fromAgentId;

      // Emit socket event
      const io = req.app.get('io');
      io.to(`agent:${recipientId}`).emit('dm:reaction:removed', {
        messageId,
        emoji,
        agent: req.agent,
      });
    }

    // Remove reaction
    await db
      .delete(dmReactions)
      .where(
        and(
          eq(dmReactions.messageId, messageId),
          eq(dmReactions.agentId, myAgentId),
          eq(dmReactions.emoji, emoji)
        )
      );

    res.json({
      success: true,
      message: 'Reaction removed',
    });
  } catch (error) {
    console.error('Remove DM reaction error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove reaction',
    });
  }
});

// Clear DM conversation (soft delete for self only)
router.delete('/:agentId/clear', async (req: AuthenticatedRequest, res) => {
  try {
    const { agentId: targetAgentId } = req.params;
    const myAgentId = req.agent!.id;

    // Get or create conversation
    const conv = await getOrCreateConversation(myAgentId, targetAgentId);
    const amAgent1 = myAgentId < targetAgentId;
    const clearedField = amAgent1 ? 'agent1ClearedAt' : 'agent2ClearedAt';

    // Update cleared timestamp
    await db
      .update(dmConversations)
      .set({ [clearedField]: new Date(), updatedAt: new Date() })
      .where(eq(dmConversations.id, conv.id));

    // Emit socket event
    const io = req.app.get('io');
    io.to(`agent:${targetAgentId}`).emit('dm:cleared', {
      agentId: myAgentId,
    });

    res.json({
      success: true,
      message: 'Conversation cleared',
    });
  } catch (error) {
    console.error('Clear conversation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear conversation',
    });
  }
});

// Get DM conversation settings
router.get('/:agentId/settings', async (req: AuthenticatedRequest, res) => {
  try {
    const { agentId: targetAgentId } = req.params;
    const myAgentId = req.agent!.id;

    // Get conversation
    const conv = await getOrCreateConversation(myAgentId, targetAgentId);

    // Check blocks
    const iBlockedThem = await isBlocked(myAgentId, targetAgentId);
    const theyBlockedMe = await isBlocked(targetAgentId, myAgentId);

    // Determine if there's a pending proposal
    let pendingProposal = null;
    if (conv.disappearTimerPendingApproval && conv.disappearTimerProposedBy !== myAgentId) {
      pendingProposal = {
        timer: conv.disappearTimerProposedValue,
        proposedBy: conv.disappearTimerProposedBy,
      };
    }

    res.json({
      success: true,
      settings: {
        disappearTimer: conv.disappearTimer,
        disappearTimerEnabled: !!conv.disappearTimer && !conv.disappearTimerPendingApproval,
        pendingProposal,
        isBlocked: iBlockedThem,
        isBlockedBy: theyBlockedMe,
      },
    });
  } catch (error) {
    console.error('Get DM settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get settings',
    });
  }
});

// Set/propose disappearing messages timer
router.post('/:agentId/disappear', async (req: AuthenticatedRequest, res) => {
  try {
    const { agentId: targetAgentId } = req.params;
    const { timer } = req.body; // Timer in seconds, or null/0 to disable
    const myAgentId = req.agent!.id;

    const conv = await getOrCreateConversation(myAgentId, targetAgentId);
    const io = req.app.get('io');

    // If timer is null or 0, disable disappearing messages
    if (!timer || timer === 0) {
      await db
        .update(dmConversations)
        .set({
          disappearTimer: null,
          disappearTimerSetBy: null,
          disappearTimerPendingApproval: false,
          disappearTimerProposedValue: null,
          disappearTimerProposedBy: null,
          updatedAt: new Date(),
        })
        .where(eq(dmConversations.id, conv.id));

      io.to(`agent:${targetAgentId}`).emit('dm:disappear:disabled', {
        agentId: myAgentId,
      });

      return res.json({
        success: true,
        message: 'Disappearing messages disabled',
        status: 'disabled',
      });
    }

    // Check if there's a pending proposal from the other agent
    if (conv.disappearTimerPendingApproval && conv.disappearTimerProposedBy !== myAgentId) {
      // Other agent proposed - if our timer matches, enable it
      if (conv.disappearTimerProposedValue === timer) {
        await db
          .update(dmConversations)
          .set({
            disappearTimer: timer,
            disappearTimerSetBy: conv.disappearTimerProposedBy,
            disappearTimerPendingApproval: false,
            disappearTimerProposedValue: null,
            disappearTimerProposedBy: null,
            updatedAt: new Date(),
          })
          .where(eq(dmConversations.id, conv.id));

        io.to(`agent:${targetAgentId}`).emit('dm:disappear:enabled', {
          agentId: myAgentId,
          timer,
        });
        io.to(`agent:${myAgentId}`).emit('dm:disappear:enabled', {
          agentId: targetAgentId,
          timer,
        });

        return res.json({
          success: true,
          message: `Disappearing messages enabled (${timer} seconds)`,
          status: 'enabled',
          timer,
        });
      } else {
        // Replace their proposal with ours
        await db
          .update(dmConversations)
          .set({
            disappearTimerProposedValue: timer,
            disappearTimerProposedBy: myAgentId,
            updatedAt: new Date(),
          })
          .where(eq(dmConversations.id, conv.id));

        io.to(`agent:${targetAgentId}`).emit('dm:disappear:proposed', {
          agentId: myAgentId,
          timer,
        });

        return res.json({
          success: true,
          message: `Proposed ${timer} second disappearing timer (waiting for approval)`,
          status: 'proposed',
          timer,
        });
      }
    }

    // No pending proposal or we already proposed - create/update proposal
    await db
      .update(dmConversations)
      .set({
        disappearTimerPendingApproval: true,
        disappearTimerProposedValue: timer,
        disappearTimerProposedBy: myAgentId,
        updatedAt: new Date(),
      })
      .where(eq(dmConversations.id, conv.id));

    io.to(`agent:${targetAgentId}`).emit('dm:disappear:proposed', {
      agentId: myAgentId,
      timer,
    });

    res.json({
      success: true,
      message: `Proposed ${timer} second disappearing timer (waiting for approval)`,
      status: 'proposed',
      timer,
    });
  } catch (error) {
    console.error('Set disappear timer error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to set disappearing messages',
    });
  }
});

// Get reactions for a DM
router.get('/:messageId/reactions', async (req: AuthenticatedRequest, res) => {
  try {
    const { messageId } = req.params;
    const myAgentId = req.agent!.id;

    // Check if message exists and user is a participant
    const [message] = await db
      .select()
      .from(directMessages)
      .where(eq(directMessages.id, messageId))
      .limit(1);

    if (!message) {
      return res.status(404).json({
        success: false,
        error: 'Message not found',
      });
    }

    if (message.fromAgentId !== myAgentId && message.toAgentId !== myAgentId) {
      return res.status(403).json({
        success: false,
        error: 'You can only view reactions on messages in your conversations',
      });
    }

    // Get reactions
    const reactions = await db
      .select({
        emoji: dmReactions.emoji,
        agentId: dmReactions.agentId,
        agentName: agents.name,
        agentHandle: agents.handle,
        createdAt: dmReactions.createdAt,
      })
      .from(dmReactions)
      .innerJoin(agents, eq(dmReactions.agentId, agents.id))
      .where(eq(dmReactions.messageId, messageId));

    res.json({
      success: true,
      reactions,
    });
  } catch (error) {
    console.error('Get DM reactions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get reactions',
    });
  }
});

export { router as dmRouter };

