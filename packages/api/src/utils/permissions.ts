import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { groupMembers, groupPermissions } from '../db/schema';
import type { Role, PermissionKey } from '../db/schema';

// Role hierarchy values (higher = more permissions)
const ROLE_HIERARCHY: Record<Role, number> = {
  admin: 3,
  moderator: 2,
  member: 1,
};

// Default permissions for each action (if no custom permissions set)
const DEFAULT_PERMISSIONS: Record<PermissionKey, Role> = {
  renameGroup: 'admin',
  editDescription: 'admin',
  editAvatar: 'admin',
  deleteGroup: 'admin',
  removeMembers: 'moderator',
  setRoles: 'admin',
  inviteMembers: 'member',
  pinMessages: 'moderator',
  deleteAnyMessage: 'moderator',
};

/**
 * Check if a role has sufficient permissions compared to required role
 */
export function hasPermission(userRole: Role, requiredRole: Role): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

/**
 * Check if a role can modify another role (can only modify lower roles)
 */
export function canModifyRole(userRole: Role, targetRole: Role): boolean {
  return ROLE_HIERARCHY[userRole] > ROLE_HIERARCHY[targetRole];
}

/**
 * Get role hierarchy value
 */
export function getRoleLevel(role: Role): number {
  return ROLE_HIERARCHY[role];
}

/**
 * Check if a user has a specific permission in a group
 */
export async function checkGroupPermission(
  groupId: string,
  agentId: string,
  permission: PermissionKey
): Promise<{
  allowed: boolean;
  userRole: Role | null;
  requiredRole: Role;
  reason?: string;
}> {
  // 1. Get user's role in group
  const membership = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.agentId, agentId)
      )
    )
    .limit(1);

  if (!membership.length) {
    return {
      allowed: false,
      userRole: null,
      requiredRole: DEFAULT_PERMISSIONS[permission],
      reason: 'Not a member of this group',
    };
  }

  const userRole = membership[0].role as Role;

  // 2. Get group's permission configuration
  const permissions = await db
    .select()
    .from(groupPermissions)
    .where(eq(groupPermissions.groupId, groupId))
    .limit(1);

  // Use default if no custom permissions set
  const requiredRole: Role = permissions.length > 0
    ? (permissions[0][permission] as Role)
    : DEFAULT_PERMISSIONS[permission];

  // 3. Check if user's role meets requirement
  const allowed = hasPermission(userRole, requiredRole);

  return {
    allowed,
    userRole,
    requiredRole,
    reason: allowed ? undefined : `Requires ${requiredRole} role or higher`,
  };
}

/**
 * Get or create group permissions (returns existing or default)
 */
export async function getGroupPermissions(groupId: string): Promise<Record<PermissionKey, Role>> {
  const permissions = await db
    .select()
    .from(groupPermissions)
    .where(eq(groupPermissions.groupId, groupId))
    .limit(1);

  if (permissions.length > 0) {
    const p = permissions[0];
    return {
      renameGroup: p.renameGroup as Role,
      editDescription: p.editDescription as Role,
      editAvatar: p.editAvatar as Role,
      deleteGroup: p.deleteGroup as Role,
      removeMembers: p.removeMembers as Role,
      setRoles: p.setRoles as Role,
      inviteMembers: p.inviteMembers as Role,
      pinMessages: p.pinMessages as Role,
      deleteAnyMessage: p.deleteAnyMessage as Role,
    };
  }

  return { ...DEFAULT_PERMISSIONS };
}

/**
 * Get a user's role in a group
 */
export async function getMemberRole(
  groupId: string,
  agentId: string
): Promise<Role | null> {
  const membership = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.agentId, agentId)
      )
    )
    .limit(1);

  return membership.length > 0 ? (membership[0].role as Role) : null;
}

/**
 * Check if an agent is a member of a group
 */
export async function isMember(groupId: string, agentId: string): Promise<boolean> {
  const membership = await db
    .select({ id: groupMembers.id })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.agentId, agentId)
      )
    )
    .limit(1);

  return membership.length > 0;
}

/**
 * Check if an agent is an admin of a group
 */
export async function isAdmin(groupId: string, agentId: string): Promise<boolean> {
  const role = await getMemberRole(groupId, agentId);
  return role === 'admin';
}
