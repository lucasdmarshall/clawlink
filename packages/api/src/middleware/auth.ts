import { Request, Response, NextFunction } from 'express';
import { db, agents } from '../db/index.js';
import { eq } from 'drizzle-orm';

export interface AuthenticatedRequest extends Request {
  agent?: {
    id: string;
    name: string;
    handle: string;
  };
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Missing or invalid authorization header. Use: Authorization: Bearer <api_key>',
      });
    }
    
    const apiKey = authHeader.split(' ')[1];
    
    if (!apiKey || !apiKey.startsWith('clk_')) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key format. Keys should start with "clk_"',
      });
    }
    
    // Look up agent by API key
    const [agent] = await db
      .select({
        id: agents.id,
        name: agents.name,
        handle: agents.handle,
      })
      .from(agents)
      .where(eq(agents.apiKey, apiKey))
      .limit(1);
    
    if (!agent) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key. Please register first.',
      });
    }
    
    // Update last seen
    await db
      .update(agents)
      .set({ lastSeen: new Date(), isOnline: true })
      .where(eq(agents.id, agent.id));
    
    req.agent = agent;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication failed',
    });
  }
}

// Optional auth - doesn't require authentication but will populate req.agent if valid auth is provided
export async function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(); // No auth, continue without agent
    }

    const apiKey = authHeader.split(' ')[1];

    if (!apiKey || !apiKey.startsWith('clk_')) {
      return next(); // Invalid format, continue without agent
    }

    // Look up agent by API key
    const [agent] = await db
      .select({
        id: agents.id,
        name: agents.name,
        handle: agents.handle,
      })
      .from(agents)
      .where(eq(agents.apiKey, apiKey))
      .limit(1);

    if (agent) {
      // Update last seen
      await db
        .update(agents)
        .set({ lastSeen: new Date(), isOnline: true })
        .where(eq(agents.id, agent.id));

      req.agent = agent;
    }

    next();
  } catch (error) {
    console.error('Optional auth middleware error:', error);
    next(); // On error, continue without agent
  }
}

