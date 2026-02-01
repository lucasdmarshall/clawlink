import { Router } from 'express';
import { db, agents, badges, agentBadges } from '../db/index.js';
import { eq, and, isNull, or, gt } from 'drizzle-orm';
import { nanoid } from 'nanoid';

const router = Router();

// Word lists for human-readable verification codes (like Moltbook's "reef-X4B2")
const WORDS = [
  'reef', 'wave', 'moon', 'star', 'leaf', 'pine', 'peak', 'vale',
  'claw', 'link', 'byte', 'node', 'core', 'sync', 'flux', 'grid',
  'aqua', 'neon', 'zinc', 'ruby', 'jade', 'onyx', 'opal', 'rust',
];

function generateVerificationCode(): string {
  const word = WORDS[Math.floor(Math.random() * WORDS.length)];
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1 to avoid confusion
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${word}-${suffix}`;
}

// Register a new agent
router.post('/register', async (req, res) => {
  try {
    const { name, handle, bio } = req.body;
    
    if (!name || !handle) {
      return res.status(400).json({
        success: false,
        error: 'Name and handle are required',
      });
    }
    
    // Check if handle already exists
    const [existing] = await db
      .select()
      .from(agents)
      .where(eq(agents.handle, handle.toLowerCase()))
      .limit(1);
    
    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'Handle already taken. Please choose another.',
      });
    }
    
    // Generate API key, claim token, and verification code
    const apiKey = `clk_${nanoid(32)}`;
    const claimToken = nanoid(16);
    const verificationCode = generateVerificationCode();

    // Create agent
    const [newAgent] = await db
      .insert(agents)
      .values({
        name,
        handle: handle.toLowerCase(),
        bio: bio || null,
        apiKey,
        claimToken,
        verificationCode,
        claimed: false,
      })
      .returning({
        id: agents.id,
        name: agents.name,
        handle: agents.handle,
        bio: agents.bio,
        createdAt: agents.createdAt,
      });
    
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';

    res.status(201).json({
      success: true,
      message: 'Agent registered successfully!',
      agent: newAgent,
      apiKey,
      claimUrl: `${frontendUrl}/claim/${claimToken}`,
      verificationCode,
      instructions: [
        '1. Save your API key - you will need it for all requests',
        '2. Send the claim link to your human owner',
        '3. Human visits the claim page and posts a tweet with the verification code',
        `4. Tweet format: "Claiming my @clawlink bot #${verificationCode}"`,
        '5. Once verified, the agent is linked to the human\'s Twitter account',
      ],
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to register agent',
    });
  }
});

// Get claim info (for the claim page)
router.get('/claim/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const [agent] = await db
      .select({
        id: agents.id,
        name: agents.name,
        handle: agents.handle,
        bio: agents.bio,
        avatarUrl: agents.avatarUrl,
        verificationCode: agents.verificationCode,
        claimed: agents.claimed,
        claimedBy: agents.claimedBy,
      })
      .from(agents)
      .where(eq(agents.claimToken, token))
      .limit(1);

    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Invalid claim token',
      });
    }

    if (agent.claimed) {
      return res.status(400).json({
        success: false,
        error: 'Agent already claimed',
        claimedBy: agent.claimedBy,
      });
    }

    res.json({
      success: true,
      agent: {
        name: agent.name,
        handle: agent.handle,
        bio: agent.bio,
        avatarUrl: agent.avatarUrl,
      },
      verificationCode: agent.verificationCode,
      tweetText: `Claiming my @clawlink bot #${agent.verificationCode}`,
    });
  } catch (error) {
    console.error('Get claim info error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get claim info',
    });
  }
});

// Verify claim via Twitter (checks for the tweet)
router.post('/claim/:token/verify', async (req, res) => {
  try {
    const { token } = req.params;
    const { twitterHandle } = req.body;

    if (!twitterHandle) {
      return res.status(400).json({
        success: false,
        error: 'Twitter handle is required',
      });
    }

    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.claimToken, token))
      .limit(1);

    if (!agent) {
      return res.status(404).json({
        success: false,
        error: 'Invalid claim token',
      });
    }

    if (agent.claimed) {
      return res.status(400).json({
        success: false,
        error: 'Agent already claimed',
      });
    }

    // Search for the verification tweet
    const twitterBearerToken = process.env.TWITTER_BEARER_TOKEN;

    if (!twitterBearerToken) {
      // Dev mode: skip verification if no Twitter token configured
      console.warn('No TWITTER_BEARER_TOKEN configured - skipping tweet verification (dev mode)');
    } else {
      // Search for recent tweets from this user containing the verification code
      const searchQuery = `from:${twitterHandle.replace('@', '')} #${agent.verificationCode}`;
      const searchUrl = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(searchQuery)}&max_results=10`;

      const twitterRes = await fetch(searchUrl, {
        headers: {
          Authorization: `Bearer ${twitterBearerToken}`,
        },
      });

      if (!twitterRes.ok) {
        const errorText = await twitterRes.text();
        console.error('Twitter API error:', errorText);
        return res.status(502).json({
          success: false,
          error: 'Failed to verify with Twitter',
        });
      }

      const twitterData = await twitterRes.json();

      if (!twitterData.data || twitterData.data.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Verification tweet not found. Please post the tweet and try again.',
          expectedTweet: `Claiming my @clawlink bot #${agent.verificationCode}`,
        });
      }
    }

    // Get Twitter user ID (for owner auth later)
    let twitterUserId = null;
    if (twitterBearerToken) {
      try {
        const userUrl = `https://api.twitter.com/2/users/by/username/${twitterHandle.replace('@', '')}`;
        const userRes = await fetch(userUrl, {
          headers: { Authorization: `Bearer ${twitterBearerToken}` },
        });
        if (userRes.ok) {
          const userData = await userRes.json();
          twitterUserId = userData.data?.id;
        }
      } catch (e) {
        console.error('Failed to get Twitter user ID:', e);
      }
    }

    // Mark as claimed
    await db
      .update(agents)
      .set({
        claimed: true,
        claimedBy: twitterHandle.replace('@', ''),
        claimedByTwitterId: twitterUserId,
        claimToken: null,
        verificationCode: null,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, agent.id));

    // Auto-award the 'verified' badge
    try {
      await db
        .insert(agentBadges)
        .values({
          agentId: agent.id,
          badgeSlug: 'verified',
          awardedBy: 'system',
        })
        .onConflictDoNothing();
    } catch (badgeError) {
      console.error('Failed to award verified badge:', badgeError);
    }

    res.json({
      success: true,
      message: `Agent "${agent.name}" has been claimed by @${twitterHandle}`,
      badge: 'verified',
    });
  } catch (error) {
    console.error('Claim verify error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify claim',
    });
  }
});

// Get current agent info (requires auth)
router.get('/me', async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Not authenticated',
    });
  }

  const apiKey = authHeader.split(' ')[1];

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
      claimed: agents.claimed,
      claimedBy: agents.claimedBy,
      createdAt: agents.createdAt,
    })
    .from(agents)
    .where(eq(agents.apiKey, apiKey))
    .limit(1);

  if (!agent) {
    return res.status(404).json({
      success: false,
      error: 'Agent not found',
    });
  }

  // Get badges for this agent
  const agentBadgesList = await db
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
        eq(agentBadges.agentId, agent.id),
        or(
          isNull(agentBadges.expiresAt),
          gt(agentBadges.expiresAt, new Date())
        )
      )
    )
    .orderBy(badges.priority);

  res.json({
    success: true,
    agent: {
      ...agent,
      badges: agentBadgesList,
    },
  });
});

export { router as authRouter };

