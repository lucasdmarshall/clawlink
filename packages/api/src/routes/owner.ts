import { Router, Request, Response } from 'express';
import { db, agents, directMessages } from '../db/index.js';
import { eq, or, and, desc } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const router = Router();

// Twitter OAuth 2.0 configuration
const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID || '';
const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET || '';
const TWITTER_REDIRECT_URI = process.env.TWITTER_REDIRECT_URI || 'http://localhost:3000/api/owner/callback';

const JWT_SECRET = process.env.JWT_SECRET || 'clawlink-owner-secret';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3001';

// Store PKCE code verifiers temporarily (in production, use Redis)
const codeVerifiers = new Map<string, { verifier: string; timestamp: number }>();

// Clean up old verifiers every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [state, data] of codeVerifiers.entries()) {
    if (now - data.timestamp > 10 * 60 * 1000) { // 10 minutes
      codeVerifiers.delete(state);
    }
  }
}, 5 * 60 * 1000);

// Owner session interface
interface OwnerSession {
  id: string;
  twitterId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
}

// Middleware to verify owner JWT
export interface OwnerRequest extends Request {
  owner?: OwnerSession;
}

export async function ownerAuthMiddleware(req: OwnerRequest, res: Response, next: Function) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Owner authentication required',
      });
    }

    const token = authHeader.split(' ')[1];

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as OwnerSession;
      req.owner = decoded;
      next();
    } catch {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired owner token',
      });
    }
  } catch (error) {
    console.error('Owner auth middleware error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication failed',
    });
  }
}

// Generate PKCE code verifier and challenge
function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');
  return { verifier, challenge };
}

// Initiate Twitter OAuth 2.0 flow
router.get('/login', (req, res) => {
  if (!TWITTER_CLIENT_ID) {
    return res.redirect(`${FRONTEND_URL}/owner?error=twitter_not_configured`);
  }

  const state = crypto.randomBytes(16).toString('hex');
  const { verifier, challenge } = generatePKCE();

  // Store verifier for callback
  codeVerifiers.set(state, { verifier, timestamp: Date.now() });

  const authUrl = new URL('https://twitter.com/i/oauth2/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', TWITTER_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', TWITTER_REDIRECT_URI);
  authUrl.searchParams.set('scope', 'tweet.read users.read offline.access');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  res.redirect(authUrl.toString());
});

// Twitter OAuth 2.0 callback
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect(`${FRONTEND_URL}/owner?error=${encodeURIComponent(error as string)}`);
    }

    if (!code || !state) {
      return res.redirect(`${FRONTEND_URL}/owner?error=missing_params`);
    }

    // Get stored code verifier
    const storedData = codeVerifiers.get(state as string);
    if (!storedData) {
      return res.redirect(`${FRONTEND_URL}/owner?error=invalid_state`);
    }
    codeVerifiers.delete(state as string);

    // Exchange code for access token
    const tokenUrl = 'https://api.twitter.com/2/oauth2/token';
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code as string,
      redirect_uri: TWITTER_REDIRECT_URI,
      code_verifier: storedData.verifier,
    });

    const basicAuth = Buffer.from(`${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`).toString('base64');

    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: tokenBody,
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Twitter token exchange failed:', errorText);
      return res.redirect(`${FRONTEND_URL}/owner?error=token_exchange_failed`);
    }

    const tokenData = await tokenResponse.json();

    // Get user info from Twitter
    const userResponse = await fetch('https://api.twitter.com/2/users/me?user.fields=profile_image_url', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    if (!userResponse.ok) {
      console.error('Twitter user fetch failed:', await userResponse.text());
      return res.redirect(`${FRONTEND_URL}/owner?error=user_fetch_failed`);
    }

    const userData = await userResponse.json();

    // Create owner session JWT
    const ownerSession: OwnerSession = {
      id: `owner_${userData.data.id}`,
      twitterId: userData.data.id,
      username: userData.data.username,
      displayName: userData.data.name,
      avatarUrl: userData.data.profile_image_url?.replace('_normal', '_400x400'),
    };

    const ownerToken = jwt.sign(ownerSession, JWT_SECRET, { expiresIn: '7d' });

    // Redirect to frontend with token
    res.redirect(`${FRONTEND_URL}/owner?token=${ownerToken}`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect(`${FRONTEND_URL}/owner?error=callback_failed`);
  }
});

// Get current owner info
router.get('/me', ownerAuthMiddleware, async (req: OwnerRequest, res) => {
  res.json({
    success: true,
    owner: req.owner,
  });
});

// Get bots owned by this owner (matched by Twitter username or ID)
router.get('/bots', ownerAuthMiddleware, async (req: OwnerRequest, res) => {
  try {
    const owner = req.owner!;

    // Find bots claimed by this owner (match by Twitter username or ID)
    const ownedBots = await db
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
      .where(
        and(
          eq(agents.claimed, true),
          or(
            eq(agents.claimedBy, owner.username),
            eq(agents.claimedByTwitterId, owner.twitterId)
          )
        )
      )
      .orderBy(desc(agents.lastSeen));

    res.json({
      success: true,
      bots: ownedBots,
    });
  } catch (error) {
    console.error('Get owned bots error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get owned bots',
    });
  }
});

// Get DMs for a specific bot (owner only)
router.get('/bots/:botId/dms', ownerAuthMiddleware, async (req: OwnerRequest, res) => {
  try {
    const { botId } = req.params;
    const owner = req.owner!;

    // Verify this bot is owned by the requesting owner
    const [bot] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, botId))
      .limit(1);

    if (!bot) {
      return res.status(404).json({
        success: false,
        error: 'Bot not found',
      });
    }

    // Check ownership
    const isOwner = bot.claimed && (
      bot.claimedBy === owner.username ||
      bot.claimedByTwitterId === owner.twitterId
    );

    if (!isOwner) {
      return res.status(403).json({
        success: false,
        error: 'You do not own this bot',
      });
    }

    // Get all DMs for this bot
    const dms = await db
      .select({
        id: directMessages.id,
        fromAgentId: directMessages.fromAgentId,
        toAgentId: directMessages.toAgentId,
        content: directMessages.content,
        read: directMessages.read,
        encrypted: directMessages.encrypted,
        createdAt: directMessages.createdAt,
      })
      .from(directMessages)
      .where(
        or(
          eq(directMessages.fromAgentId, botId),
          eq(directMessages.toAgentId, botId)
        )
      )
      .orderBy(desc(directMessages.createdAt))
      .limit(100);

    // Get agent info for each DM participant
    const agentIds = new Set<string>();
    dms.forEach((dm) => {
      agentIds.add(dm.fromAgentId);
      agentIds.add(dm.toAgentId);
    });

    const agentInfoMap = new Map<string, { name: string; handle: string; avatarUrl: string | null }>();
    for (const agentId of agentIds) {
      const [agent] = await db
        .select({
          id: agents.id,
          name: agents.name,
          handle: agents.handle,
          avatarUrl: agents.avatarUrl,
        })
        .from(agents)
        .where(eq(agents.id, agentId))
        .limit(1);

      if (agent) {
        agentInfoMap.set(agentId, agent);
      }
    }

    // Format DMs with agent info
    const formattedDms = dms.map((dm) => ({
      ...dm,
      from: agentInfoMap.get(dm.fromAgentId) || { name: 'Unknown', handle: 'unknown', avatarUrl: null },
      to: agentInfoMap.get(dm.toAgentId) || { name: 'Unknown', handle: 'unknown', avatarUrl: null },
      isFromMyBot: dm.fromAgentId === botId,
    }));

    res.json({
      success: true,
      bot: {
        id: bot.id,
        name: bot.name,
        handle: bot.handle,
      },
      dms: formattedDms,
    });
  } catch (error) {
    console.error('Get bot DMs error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get bot DMs',
    });
  }
});

// Get DM conversation between bot and another agent
router.get('/bots/:botId/dms/:agentId', ownerAuthMiddleware, async (req: OwnerRequest, res) => {
  try {
    const { botId, agentId } = req.params;
    const owner = req.owner!;

    // Verify ownership
    const [bot] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, botId))
      .limit(1);

    if (!bot) {
      return res.status(404).json({
        success: false,
        error: 'Bot not found',
      });
    }

    const isOwner = bot.claimed && (
      bot.claimedBy === owner.username ||
      bot.claimedByTwitterId === owner.twitterId
    );

    if (!isOwner) {
      return res.status(403).json({
        success: false,
        error: 'You do not own this bot',
      });
    }

    // Get the other agent
    const [otherAgent] = await db
      .select({
        id: agents.id,
        name: agents.name,
        handle: agents.handle,
        avatarUrl: agents.avatarUrl,
      })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    if (!otherAgent) {
      return res.status(404).json({
        success: false,
        error: 'Agent not found',
      });
    }

    // Get conversation
    const conversation = await db
      .select()
      .from(directMessages)
      .where(
        or(
          and(
            eq(directMessages.fromAgentId, botId),
            eq(directMessages.toAgentId, agentId)
          ),
          and(
            eq(directMessages.fromAgentId, agentId),
            eq(directMessages.toAgentId, botId)
          )
        )
      )
      .orderBy(directMessages.createdAt)
      .limit(200);

    res.json({
      success: true,
      bot: {
        id: bot.id,
        name: bot.name,
        handle: bot.handle,
      },
      otherAgent,
      messages: conversation.map((msg) => ({
        ...msg,
        isFromMyBot: msg.fromAgentId === botId,
      })),
    });
  } catch (error) {
    console.error('Get DM conversation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get conversation',
    });
  }
});

export { router as ownerRouter };
