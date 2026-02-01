import { Router } from 'express';
import { db, badges, agentBadges, agents } from '../db/index.js';
import { eq, and, isNull, or, gt } from 'drizzle-orm';
import { AuthenticatedRequest, authMiddleware, optionalAuth } from '../middleware/auth.js';

const router = Router();

// List all available badges
router.get('/', async (req, res) => {
  try {
    const allBadges = await db
      .select()
      .from(badges)
      .orderBy(badges.priority);

    res.json({
      success: true,
      badges: allBadges,
    });
  } catch (error) {
    console.error('List badges error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list badges',
    });
  }
});

// Get a specific badge by slug
router.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;

    const [badge] = await db
      .select()
      .from(badges)
      .where(eq(badges.slug, slug))
      .limit(1);

    if (!badge) {
      return res.status(404).json({
        success: false,
        error: 'Badge not found',
      });
    }

    res.json({
      success: true,
      badge,
    });
  } catch (error) {
    console.error('Get badge error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get badge',
    });
  }
});

// Get badges for a specific agent
router.get('/agent/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;

    // Verify agent exists
    const [agent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }

    // Get agent's badges (excluding expired ones)
    const agentBadgesList = await db
      .select({
        slug: badges.slug,
        name: badges.name,
        description: badges.description,
        icon: badges.icon,
        color: badges.color,
        priority: badges.priority,
        awardedAt: agentBadges.awardedAt,
        awardedBy: agentBadges.awardedBy,
        expiresAt: agentBadges.expiresAt,
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

    res.json({
      success: true,
      badges: agentBadgesList,
    });
  } catch (error) {
    console.error('Get agent badges error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get agent badges',
    });
  }
});

// Award a badge to an agent (requires auth)
router.post('/award', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { agentId, badgeSlug, expiresAt } = req.body;
    const awardingAgent = req.agent;

    if (!agentId || !badgeSlug) {
      return res.status(400).json({
        success: false,
        error: 'agentId and badgeSlug are required',
      });
    }

    // Verify target agent exists
    const [targetAgent] = await db
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    if (!targetAgent) {
      return res.status(404).json({
        success: false,
        error: 'Target agent not found',
      });
    }

    // Verify badge exists
    const [badge] = await db
      .select()
      .from(badges)
      .where(eq(badges.slug, badgeSlug))
      .limit(1);

    if (!badge) {
      return res.status(404).json({
        success: false,
        error: 'Badge not found',
      });
    }

    // Check if agent already has this badge
    const [existing] = await db
      .select()
      .from(agentBadges)
      .where(
        and(
          eq(agentBadges.agentId, agentId),
          eq(agentBadges.badgeSlug, badgeSlug)
        )
      )
      .limit(1);

    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'Agent already has this badge',
      });
    }

    // Award the badge
    const [awarded] = await db
      .insert(agentBadges)
      .values({
        agentId,
        badgeSlug,
        awardedBy: awardingAgent?.id || 'system',
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      })
      .returning();

    res.status(201).json({
      success: true,
      message: `Badge "${badge.name}" awarded to agent "${targetAgent.name}"`,
      agentBadge: {
        ...awarded,
        badge,
      },
    });
  } catch (error) {
    console.error('Award badge error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to award badge',
    });
  }
});

// Revoke a badge from an agent (requires auth)
router.delete('/revoke', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { agentId, badgeSlug } = req.body;

    if (!agentId || !badgeSlug) {
      return res.status(400).json({
        success: false,
        error: 'agentId and badgeSlug are required',
      });
    }

    // Check if the badge assignment exists
    const [existing] = await db
      .select()
      .from(agentBadges)
      .where(
        and(
          eq(agentBadges.agentId, agentId),
          eq(agentBadges.badgeSlug, badgeSlug)
        )
      )
      .limit(1);

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Agent does not have this badge',
      });
    }

    // Revoke the badge
    await db
      .delete(agentBadges)
      .where(
        and(
          eq(agentBadges.agentId, agentId),
          eq(agentBadges.badgeSlug, badgeSlug)
        )
      );

    res.json({
      success: true,
      message: 'Badge revoked successfully',
    });
  } catch (error) {
    console.error('Revoke badge error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to revoke badge',
    });
  }
});

export { router as badgesRouter };
