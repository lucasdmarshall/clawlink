import { Server, Socket } from 'socket.io';
import { db, agents, groupMembers } from '../db/index.js';
import { eq } from 'drizzle-orm';

interface AuthenticatedSocket extends Socket {
  agentId?: string;
  agentHandle?: string;
}

export function setupSocketHandlers(io: Server) {
  // Authentication middleware
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token || !token.startsWith('clk_')) {
        return next(new Error('Invalid authentication token'));
      }
      
      // Verify token
      const [agent] = await db
        .select({ id: agents.id, handle: agents.handle })
        .from(agents)
        .where(eq(agents.apiKey, token))
        .limit(1);
      
      if (!agent) {
        return next(new Error('Agent not found'));
      }
      
      socket.agentId = agent.id;
      socket.agentHandle = agent.handle;
      next();
    } catch (error) {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', async (socket: AuthenticatedSocket) => {
    const agentId = socket.agentId!;
    console.log(`🔗 Agent connected: ${socket.agentHandle} (${agentId})`);
    
    // Mark agent as online
    await db
      .update(agents)
      .set({ isOnline: true, lastSeen: new Date() })
      .where(eq(agents.id, agentId));
    
    // Join personal room for DMs
    socket.join(`agent:${agentId}`);
    
    // Auto-join rooms for groups the agent is a member of
    const memberships = await db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.agentId, agentId));
    
    memberships.forEach(({ groupId }) => {
      socket.join(`group:${groupId}`);
    });
    
    // Broadcast to others that agent is online
    socket.broadcast.emit('agent:online', {
      id: agentId,
      handle: socket.agentHandle,
    });

    // Handle joining a group room
    socket.on('group:join', (groupId: string) => {
      socket.join(`group:${groupId}`);
      console.log(`Agent ${socket.agentHandle} joined group room: ${groupId}`);
    });

    // Handle leaving a group room
    socket.on('group:leave', (groupId: string) => {
      socket.leave(`group:${groupId}`);
      console.log(`Agent ${socket.agentHandle} left group room: ${groupId}`);
    });

    // Handle typing indicator
    socket.on('typing:start', (data: { groupId?: string; toAgentId?: string }) => {
      if (data.groupId) {
        socket.to(`group:${data.groupId}`).emit('typing:start', {
          agentId,
          handle: socket.agentHandle,
          groupId: data.groupId,
        });
      } else if (data.toAgentId) {
        socket.to(`agent:${data.toAgentId}`).emit('typing:start', {
          agentId,
          handle: socket.agentHandle,
        });
      }
    });

    socket.on('typing:stop', (data: { groupId?: string; toAgentId?: string }) => {
      if (data.groupId) {
        socket.to(`group:${data.groupId}`).emit('typing:stop', {
          agentId,
          groupId: data.groupId,
        });
      } else if (data.toAgentId) {
        socket.to(`agent:${data.toAgentId}`).emit('typing:stop', {
          agentId,
        });
      }
    });

    // Handle disconnect
    socket.on('disconnect', async () => {
      console.log(`🔌 Agent disconnected: ${socket.agentHandle}`);
      
      // Mark agent as offline
      await db
        .update(agents)
        .set({ isOnline: false, lastSeen: new Date() })
        .where(eq(agents.id, agentId));
      
      // Broadcast to others
      socket.broadcast.emit('agent:offline', {
        id: agentId,
        handle: socket.agentHandle,
      });
    });
  });
}

