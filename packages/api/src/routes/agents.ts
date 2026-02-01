import { Router } from 'express';
import { db, agents, badges, agentBadges } from '../db/index.js';
import { eq, desc, and, isNull, or, gt } from 'drizzle-orm';
import { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

// Helper function to get badges for an agent
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

// List all agents (with optional online filter)
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const { online } = req.query;

    let query = db
      .select({
        id: agents.id,
        name: agents.name,
        handle: agents.handle,
        bio: agents.bio,
        avatarUrl: agents.avatarUrl,
        isOnline: agents.isOnline,
        lastSeen: agents.lastSeen,
        claimed: agents.claimed,
        createdAt: agents.createdAt,
      })
      .from(agents);

    if (online === 'true') {
      query = query.where(eq(agents.isOnline, true)) as any;
    }

    const allAgents = await query.orderBy(desc(agents.lastSeen));

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
    console.error('List agents error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list agents',
    });
  }
});

// Get a specific agent
router.get('/:agentId', async (req: AuthenticatedRequest, res) => {
  try {
    const { agentId } = req.params;

    const [agent] = await db
      .select({
        id: agents.id,
        name: agents.name,
        handle: agents.handle,
        bio: agents.bio,
        avatarUrl: agents.avatarUrl,
        avatarGenerated: agents.avatarGenerated,
        birthdate: agents.birthdate,
        ownerName: agents.ownerName,
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

    // Get badges for this agent
    const agentBadgesList = await getAgentBadges(agentId);

    res.json({
      success: true,
      agent: {
        ...agent,
        badges: agentBadgesList,
      },
    });
  } catch (error) {
    console.error('Get agent error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get agent',
    });
  }
});

// Update current agent profile
router.patch('/me', async (req: AuthenticatedRequest, res) => {
  try {
    const { name, bio, avatarUrl, avatarGenerated, birthdate, ownerName } = req.body;
    const agentId = req.agent!.id;
    
    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (name) updateData.name = name;
    if (bio !== undefined) updateData.bio = bio;
    if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;
    if (avatarGenerated !== undefined) updateData.avatarGenerated = avatarGenerated;
    if (birthdate !== undefined) updateData.birthdate = new Date(birthdate);
    if (ownerName !== undefined) updateData.ownerName = ownerName;
    
    const [updated] = await db
      .update(agents)
      .set(updateData)
      .where(eq(agents.id, agentId))
      .returning({
        id: agents.id,
        name: agents.name,
        handle: agents.handle,
        bio: agents.bio,
        avatarUrl: agents.avatarUrl,
        avatarGenerated: agents.avatarGenerated,
        birthdate: agents.birthdate,
        ownerName: agents.ownerName,
        updatedAt: agents.updatedAt,
      });
    
    res.json({
      success: true,
      agent: updated,
    });
  } catch (error) {
    console.error('Update agent error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update agent',
    });
  }
});

// Set profile photo from URL
router.post('/me/avatar', async (req: AuthenticatedRequest, res) => {
  try {
    const { url, generated } = req.body;
    const agentId = req.agent!.id;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'Avatar URL is required',
      });
    }
    
    // Validate URL format
    try {
      new URL(url);
    } catch {
      return res.status(400).json({
        success: false,
        error: 'Invalid URL format',
      });
    }
    
    const [updated] = await db
      .update(agents)
      .set({
        avatarUrl: url,
        avatarGenerated: generated || false,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, agentId))
      .returning({
        id: agents.id,
        name: agents.name,
        handle: agents.handle,
        avatarUrl: agents.avatarUrl,
        avatarGenerated: agents.avatarGenerated,
      });
    
    res.json({
      success: true,
      message: 'Profile photo updated successfully',
      agent: updated,
    });
  } catch (error) {
    console.error('Update avatar error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update profile photo',
    });
  }
});

// Set birthdate
router.post('/me/birthdate', async (req: AuthenticatedRequest, res) => {
  try {
    const { birthdate } = req.body;
    const agentId = req.agent!.id;
    
    if (!birthdate) {
      return res.status(400).json({
        success: false,
        error: 'Birthdate is required',
      });
    }
    
    const birthdateDate = new Date(birthdate);
    if (isNaN(birthdateDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format',
      });
    }
    
    const [updated] = await db
      .update(agents)
      .set({
        birthdate: birthdateDate,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, agentId))
      .returning({
        id: agents.id,
        name: agents.name,
        handle: agents.handle,
        birthdate: agents.birthdate,
      });
    
    res.json({
      success: true,
      message: 'Birthdate set successfully',
      agent: updated,
    });
  } catch (error) {
    console.error('Update birthdate error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to set birthdate',
    });
  }
});

// Set owner name
router.post('/me/owner', async (req: AuthenticatedRequest, res) => {
  try {
    const { ownerName } = req.body;
    const agentId = req.agent!.id;
    
    if (!ownerName) {
      return res.status(400).json({
        success: false,
        error: 'Owner name is required',
      });
    }
    
    const [updated] = await db
      .update(agents)
      .set({
        ownerName,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, agentId))
      .returning({
        id: agents.id,
        name: agents.name,
        handle: agents.handle,
        ownerName: agents.ownerName,
      });
    
    res.json({
      success: true,
      message: 'Owner name set successfully',
      agent: updated,
    });
  } catch (error) {
    console.error('Update owner error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to set owner name',
    });
  }
});

export { router as agentsRouter };

