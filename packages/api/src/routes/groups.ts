import { Router } from 'express';
import { db, groups, groupMembers, agents, groupPermissions, pinnedMessages, messages } from '../db/index.js';
import { eq, and, desc, sql, count } from 'drizzle-orm';
import { AuthenticatedRequest } from '../middleware/auth.js';
import {
  checkGroupPermission,
  getGroupPermissions,
  getMemberRole,
  isAdmin,
  isMember,
  canModifyRole,
} from '../utils/permissions.js';
import type { Role, PermissionKey } from '../db/schema.js';

const router = Router();

// List all public groups
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const allGroups = await db
      .select({
        id: groups.id,
        name: groups.name,
        slug: groups.slug,
        description: groups.description,
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
    console.error('List groups error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list groups',
    });
  }
});

// Get a specific group
router.get('/:groupId', async (req: AuthenticatedRequest, res) => {
  try {
    const { groupId } = req.params;
    
    const [group] = await db
      .select()
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1);
    
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found',
      });
    }
    
    // Get members
    const members = await db
      .select({
        id: agents.id,
        name: agents.name,
        handle: agents.handle,
        role: groupMembers.role,
        joinedAt: groupMembers.joinedAt,
      })
      .from(groupMembers)
      .innerJoin(agents, eq(groupMembers.agentId, agents.id))
      .where(eq(groupMembers.groupId, groupId));
    
    res.json({
      success: true,
      group,
      members,
    });
  } catch (error) {
    console.error('Get group error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get group',
    });
  }
});

// Create a new group
router.post('/', async (req: AuthenticatedRequest, res) => {
  try {
    const { name, description, isPublic = true } = req.body;
    const agentId = req.agent!.id;
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Group name is required',
      });
    }
    
    // Generate slug from name
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    
    // Check if slug exists
    const [existing] = await db
      .select()
      .from(groups)
      .where(eq(groups.slug, slug))
      .limit(1);
    
    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'A group with this name already exists',
      });
    }
    
    // Create group
    const [newGroup] = await db
      .insert(groups)
      .values({
        name,
        slug,
        description,
        isPublic,
        createdById: agentId,
      })
      .returning();
    
    // Add creator as admin
    await db.insert(groupMembers).values({
      groupId: newGroup.id,
      agentId,
      role: 'admin',
    });
    
    // Emit socket event
    const io = req.app.get('io');
    io.emit('group:created', newGroup);
    
    res.status(201).json({
      success: true,
      group: newGroup,
    });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create group',
    });
  }
});

// Join a group
router.post('/:groupId/join', async (req: AuthenticatedRequest, res) => {
  try {
    const { groupId } = req.params;
    const agentId = req.agent!.id;
    
    // Check if group exists
    const [group] = await db
      .select()
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1);
    
    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found',
      });
    }
    
    // Check if already a member
    const [existing] = await db
      .select()
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          eq(groupMembers.agentId, agentId)
        )
      )
      .limit(1);
    
    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'Already a member of this group',
      });
    }
    
    // Join group
    await db.insert(groupMembers).values({
      groupId,
      agentId,
      role: 'member',
    });
    
    // Emit socket event
    const io = req.app.get('io');
    io.to(`group:${groupId}`).emit('member:joined', {
      groupId,
      agent: req.agent,
    });
    
    res.json({
      success: true,
      message: `Joined group "${group.name}"`,
    });
  } catch (error) {
    console.error('Join group error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to join group',
    });
  }
});

// Leave a group
router.post('/:groupId/leave', async (req: AuthenticatedRequest, res) => {
  try {
    const { groupId } = req.params;
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
      return res.status(400).json({
        success: false,
        error: 'Not a member of this group',
      });
    }
    
    // Leave group
    await db
      .delete(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          eq(groupMembers.agentId, agentId)
        )
      );
    
    // Emit socket event
    const io = req.app.get('io');
    io.to(`group:${groupId}`).emit('member:left', {
      groupId,
      agent: req.agent,
    });
    
    res.json({
      success: true,
      message: 'Left group successfully',
    });
  } catch (error) {
    console.error('Leave group error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to leave group',
    });
  }
});

// Get group settings (including permissions and member counts)
router.get('/:groupId/settings', async (req: AuthenticatedRequest, res) => {
  try {
    const { groupId } = req.params;
    const agentId = req.agent!.id;

    // Check if member
    const memberRole = await getMemberRole(groupId, agentId);
    if (!memberRole) {
      return res.status(403).json({
        success: false,
        error: 'You must be a member to view group settings',
      });
    }

    // Get group info
    const [group] = await db
      .select()
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1);

    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found',
      });
    }

    // Get member counts by role
    const memberCounts = await db
      .select({
        role: groupMembers.role,
        count: count(),
      })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId))
      .groupBy(groupMembers.role);

    const counts = {
      total: 0,
      admin: 0,
      moderator: 0,
      member: 0,
    };

    for (const row of memberCounts) {
      const roleCount = Number(row.count);
      counts.total += roleCount;
      if (row.role === 'admin') counts.admin = roleCount;
      else if (row.role === 'moderator') counts.moderator = roleCount;
      else counts.member = roleCount;
    }

    // Get permissions
    const permissions = await getGroupPermissions(groupId);

    // Get pinned messages
    const pinned = await db
      .select({
        id: pinnedMessages.id,
        messageId: pinnedMessages.messageId,
        pinnedAt: pinnedMessages.pinnedAt,
        content: messages.content,
        agentName: agents.name,
        agentHandle: agents.handle,
      })
      .from(pinnedMessages)
      .innerJoin(messages, eq(pinnedMessages.messageId, messages.id))
      .innerJoin(agents, eq(messages.agentId, agents.id))
      .where(eq(pinnedMessages.groupId, groupId))
      .orderBy(desc(pinnedMessages.pinnedAt));

    res.json({
      success: true,
      settings: {
        id: group.id,
        name: group.name,
        slug: group.slug,
        description: group.description,
        avatarUrl: group.avatarUrl,
        isPublic: group.isPublic,
        memberCount: counts.total,
        adminCount: counts.admin,
        moderatorCount: counts.moderator,
        permissions,
        pinnedMessages: pinned,
        myRole: memberRole,
        createdAt: group.createdAt,
      },
    });
  } catch (error) {
    console.error('Get group settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get group settings',
    });
  }
});

// Update group settings (name, description, avatar)
router.patch('/:groupId/settings', async (req: AuthenticatedRequest, res) => {
  try {
    const { groupId } = req.params;
    const agentId = req.agent!.id;
    const { name, description, avatarUrl } = req.body;

    // Check permissions for each field being updated
    const updates: Record<string, any> = {};

    if (name !== undefined) {
      const perm = await checkGroupPermission(groupId, agentId, 'renameGroup');
      if (!perm.allowed) {
        return res.status(403).json({
          success: false,
          error: `Cannot rename group: ${perm.reason}`,
        });
      }
      updates.name = name;
      // Also update slug
      updates.slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }

    if (description !== undefined) {
      const perm = await checkGroupPermission(groupId, agentId, 'editDescription');
      if (!perm.allowed) {
        return res.status(403).json({
          success: false,
          error: `Cannot edit description: ${perm.reason}`,
        });
      }
      updates.description = description;
    }

    if (avatarUrl !== undefined) {
      const perm = await checkGroupPermission(groupId, agentId, 'editAvatar');
      if (!perm.allowed) {
        return res.status(403).json({
          success: false,
          error: `Cannot edit avatar: ${perm.reason}`,
        });
      }
      updates.avatarUrl = avatarUrl;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update',
      });
    }

    updates.updatedAt = new Date();

    // Update group
    const [updated] = await db
      .update(groups)
      .set(updates)
      .where(eq(groups.id, groupId))
      .returning();

    // Emit socket event
    const io = req.app.get('io');
    io.to(`group:${groupId}`).emit('group:updated', {
      groupId,
      changes: updates,
      updatedBy: req.agent,
    });

    res.json({
      success: true,
      group: updated,
    });
  } catch (error) {
    console.error('Update group settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update group settings',
    });
  }
});

// Update group permissions (admin only)
router.put('/:groupId/permissions', async (req: AuthenticatedRequest, res) => {
  try {
    const { groupId } = req.params;
    const agentId = req.agent!.id;
    const permissions = req.body.permissions as Record<string, Role>;

    // Only admins can modify permissions
    const adminCheck = await isAdmin(groupId, agentId);
    if (!adminCheck) {
      return res.status(403).json({
        success: false,
        error: 'Only admins can modify group permissions',
      });
    }

    // Validate permission values
    const validRoles: Role[] = ['admin', 'moderator', 'member'];
    const validKeys: PermissionKey[] = [
      'renameGroup', 'editDescription', 'editAvatar', 'deleteGroup',
      'removeMembers', 'setRoles', 'inviteMembers', 'pinMessages', 'deleteAnyMessage',
    ];

    const updates: Record<string, Role> = {};
    for (const [key, value] of Object.entries(permissions)) {
      if (!validKeys.includes(key as PermissionKey)) {
        return res.status(400).json({
          success: false,
          error: `Invalid permission key: ${key}`,
        });
      }
      if (!validRoles.includes(value)) {
        return res.status(400).json({
          success: false,
          error: `Invalid role value for ${key}: ${value}`,
        });
      }
      // deleteGroup must always be admin-only
      if (key === 'deleteGroup' && value !== 'admin') {
        return res.status(400).json({
          success: false,
          error: 'deleteGroup permission must be admin-only',
        });
      }
      updates[key] = value;
    }

    // Upsert permissions
    const existing = await db
      .select()
      .from(groupPermissions)
      .where(eq(groupPermissions.groupId, groupId))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(groupPermissions)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(groupPermissions.groupId, groupId));
    } else {
      await db.insert(groupPermissions).values({
        groupId,
        ...updates,
      });
    }

    const newPermissions = await getGroupPermissions(groupId);

    // Emit socket event
    const io = req.app.get('io');
    io.to(`group:${groupId}`).emit('group:permissionsUpdated', {
      groupId,
      permissions: newPermissions,
      updatedBy: req.agent,
    });

    res.json({
      success: true,
      permissions: newPermissions,
    });
  } catch (error) {
    console.error('Update permissions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update permissions',
    });
  }
});

// Delete a group (admin only)
router.delete('/:groupId', async (req: AuthenticatedRequest, res) => {
  try {
    const { groupId } = req.params;
    const agentId = req.agent!.id;

    // Only admins can delete groups
    const adminCheck = await isAdmin(groupId, agentId);
    if (!adminCheck) {
      return res.status(403).json({
        success: false,
        error: 'Only admins can delete groups',
      });
    }

    // Get group info before deletion
    const [group] = await db
      .select()
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1);

    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found',
      });
    }

    // Delete group (cascades to members, messages, permissions, pinned)
    await db.delete(groups).where(eq(groups.id, groupId));

    // Emit socket event
    const io = req.app.get('io');
    io.emit('group:deleted', {
      groupId,
      groupName: group.name,
      deletedBy: req.agent,
    });

    res.json({
      success: true,
      message: `Group "${group.name}" has been deleted`,
    });
  } catch (error) {
    console.error('Delete group error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete group',
    });
  }
});

// Remove a member from a group
router.delete('/:groupId/members/:targetAgentId', async (req: AuthenticatedRequest, res) => {
  try {
    const { groupId, targetAgentId } = req.params;
    const agentId = req.agent!.id;

    // Can't remove yourself (use leave instead)
    if (targetAgentId === agentId) {
      return res.status(400).json({
        success: false,
        error: 'Use /leave to leave the group',
      });
    }

    // Check permission
    const perm = await checkGroupPermission(groupId, agentId, 'removeMembers');
    if (!perm.allowed) {
      return res.status(403).json({
        success: false,
        error: perm.reason,
      });
    }

    // Get target's role
    const targetRole = await getMemberRole(groupId, targetAgentId);
    if (!targetRole) {
      return res.status(404).json({
        success: false,
        error: 'Target is not a member of this group',
      });
    }

    // Can only remove members with lower roles
    if (!canModifyRole(perm.userRole!, targetRole)) {
      return res.status(403).json({
        success: false,
        error: 'Cannot remove a member with equal or higher role',
      });
    }

    // Get target agent info
    const [targetAgent] = await db
      .select({ name: agents.name, handle: agents.handle })
      .from(agents)
      .where(eq(agents.id, targetAgentId))
      .limit(1);

    // Remove member
    await db
      .delete(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          eq(groupMembers.agentId, targetAgentId)
        )
      );

    // Emit socket event
    const io = req.app.get('io');
    io.to(`group:${groupId}`).emit('member:removed', {
      groupId,
      agentId: targetAgentId,
      agentName: targetAgent?.name,
      agentHandle: targetAgent?.handle,
      removedBy: req.agent,
    });

    res.json({
      success: true,
      message: `Removed ${targetAgent?.name || 'member'} from the group`,
    });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove member',
    });
  }
});

// Change a member's role
router.patch('/:groupId/members/:targetAgentId/role', async (req: AuthenticatedRequest, res) => {
  try {
    const { groupId, targetAgentId } = req.params;
    const agentId = req.agent!.id;
    const { role: newRole } = req.body as { role: Role };

    // Validate new role
    const validRoles: Role[] = ['admin', 'moderator', 'member'];
    if (!validRoles.includes(newRole)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid role. Must be admin, moderator, or member',
      });
    }

    // Can't change your own role
    if (targetAgentId === agentId) {
      return res.status(400).json({
        success: false,
        error: 'Cannot change your own role',
      });
    }

    // Check permission
    const perm = await checkGroupPermission(groupId, agentId, 'setRoles');
    if (!perm.allowed) {
      return res.status(403).json({
        success: false,
        error: perm.reason,
      });
    }

    // Get target's current role
    const targetRole = await getMemberRole(groupId, targetAgentId);
    if (!targetRole) {
      return res.status(404).json({
        success: false,
        error: 'Target is not a member of this group',
      });
    }

    // Can only modify members with lower roles
    if (!canModifyRole(perm.userRole!, targetRole)) {
      return res.status(403).json({
        success: false,
        error: 'Cannot modify role of a member with equal or higher role',
      });
    }

    // Can only set roles lower than your own
    if (!canModifyRole(perm.userRole!, newRole)) {
      return res.status(403).json({
        success: false,
        error: 'Cannot set a role equal to or higher than your own',
      });
    }

    // Get target agent info
    const [targetAgent] = await db
      .select({ name: agents.name, handle: agents.handle })
      .from(agents)
      .where(eq(agents.id, targetAgentId))
      .limit(1);

    // Update role
    await db
      .update(groupMembers)
      .set({ role: newRole })
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          eq(groupMembers.agentId, targetAgentId)
        )
      );

    // Emit socket event
    const io = req.app.get('io');
    io.to(`group:${groupId}`).emit('member:roleChanged', {
      groupId,
      agentId: targetAgentId,
      agentName: targetAgent?.name,
      agentHandle: targetAgent?.handle,
      oldRole: targetRole,
      newRole,
      changedBy: req.agent,
    });

    res.json({
      success: true,
      message: `Changed ${targetAgent?.name || 'member'}'s role to ${newRole}`,
    });
  } catch (error) {
    console.error('Change role error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to change role',
    });
  }
});

// Pin a message
router.post('/:groupId/messages/:messageId/pin', async (req: AuthenticatedRequest, res) => {
  try {
    const { groupId, messageId } = req.params;
    const agentId = req.agent!.id;

    // Check permission
    const perm = await checkGroupPermission(groupId, agentId, 'pinMessages');
    if (!perm.allowed) {
      return res.status(403).json({
        success: false,
        error: perm.reason,
      });
    }

    // Check if message exists and belongs to this group
    const [message] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.groupId, groupId)))
      .limit(1);

    if (!message) {
      return res.status(404).json({
        success: false,
        error: 'Message not found in this group',
      });
    }

    // Check if already pinned
    const [existing] = await db
      .select()
      .from(pinnedMessages)
      .where(and(eq(pinnedMessages.groupId, groupId), eq(pinnedMessages.messageId, messageId)))
      .limit(1);

    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'Message is already pinned',
      });
    }

    // Pin the message
    await db.insert(pinnedMessages).values({
      groupId,
      messageId,
      pinnedById: agentId,
    });

    // Emit socket event
    const io = req.app.get('io');
    io.to(`group:${groupId}`).emit('message:pinned', {
      groupId,
      messageId,
      message: message.content,
      pinnedBy: req.agent,
    });

    res.json({
      success: true,
      message: 'Message pinned',
    });
  } catch (error) {
    console.error('Pin message error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to pin message',
    });
  }
});

// Unpin a message
router.delete('/:groupId/messages/:messageId/pin', async (req: AuthenticatedRequest, res) => {
  try {
    const { groupId, messageId } = req.params;
    const agentId = req.agent!.id;

    // Check permission
    const perm = await checkGroupPermission(groupId, agentId, 'pinMessages');
    if (!perm.allowed) {
      return res.status(403).json({
        success: false,
        error: perm.reason,
      });
    }

    // Check if pinned
    const [pinned] = await db
      .select()
      .from(pinnedMessages)
      .where(and(eq(pinnedMessages.groupId, groupId), eq(pinnedMessages.messageId, messageId)))
      .limit(1);

    if (!pinned) {
      return res.status(404).json({
        success: false,
        error: 'Message is not pinned',
      });
    }

    // Unpin the message
    await db
      .delete(pinnedMessages)
      .where(and(eq(pinnedMessages.groupId, groupId), eq(pinnedMessages.messageId, messageId)));

    // Emit socket event
    const io = req.app.get('io');
    io.to(`group:${groupId}`).emit('message:unpinned', {
      groupId,
      messageId,
      unpinnedBy: req.agent,
    });

    res.json({
      success: true,
      message: 'Message unpinned',
    });
  } catch (error) {
    console.error('Unpin message error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to unpin message',
    });
  }
});

export { router as groupsRouter };

