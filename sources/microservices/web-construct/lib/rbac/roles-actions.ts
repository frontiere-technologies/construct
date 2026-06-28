'use server'

import { requireAdmin } from '@/lib/rbac/auth-guard'
import { createAdminClient } from '@/lib/supabase-server'
import type { PermissionDelta, RoleType } from './types'

const ROLE_TYPE_SERVICE = 2

async function getRoleType(supabase: ReturnType<typeof createAdminClient>, roleId: number): Promise<RoleType> {
  const { data, error } = await supabase
    .from('role').select('role_type:role_type(description)').eq('id_role', roleId).single()
  if (error) throw new Error(`Role not found: ${error.message}`)
  const desc = (data as { role_type?: { description?: string } })?.role_type?.description
  return (desc as RoleType) ?? 'SERVICE'
}

export async function createRole(roleName: string): Promise<{ id: number }> {
  await requireAdmin()
  const name = roleName.trim()
  if (!name) throw new Error('Role name is required')
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('role').insert({ description: name, id_role_type: ROLE_TYPE_SERVICE })
    .select('id_role').single()
  if (error) throw new Error(`Failed to create role: ${error.message}`)
  return { id: Number(data.id_role) }
}

export async function renameRole(roleId: number, roleName: string): Promise<void> {
  await requireAdmin()
  const name = roleName.trim()
  if (!name) throw new Error('Role name is required')
  const supabase = createAdminClient()
  if (await getRoleType(supabase, roleId) !== 'SERVICE') throw new Error('This role cannot be renamed')
  const { error } = await supabase.from('role').update({ description: name }).eq('id_role', roleId)
  if (error) throw new Error(`Failed to rename role: ${error.message}`)
}

export async function updateRolePermissions(roleId: number, deltas: PermissionDelta[]): Promise<void> {
  await requireAdmin()
  const supabase = createAdminClient()
  if (await getRoleType(supabase, roleId) === 'SYSTEM') throw new Error('System roles cannot be edited')

  const grants = deltas.filter(d => d.authorization).map(d => ({ id_role: roleId, id_item: d.idItem, authorized: true }))
  const revokeIds = deltas.filter(d => !d.authorization).map(d => d.idItem)

  if (grants.length) {
    const { error } = await supabase.from('role_item').upsert(grants, { onConflict: 'id_role,id_item' })
    if (error) throw new Error(`Failed to grant permissions: ${error.message}`)
  }
  if (revokeIds.length) {
    const { error } = await supabase.from('role_item').delete().eq('id_role', roleId).in('id_item', revokeIds)
    if (error) throw new Error(`Failed to revoke permissions: ${error.message}`)
  }
}

export async function deleteRole(roleId: number): Promise<void> {
  await requireAdmin()
  const supabase = createAdminClient()
  if (await getRoleType(supabase, roleId) === 'SYSTEM') throw new Error('System roles cannot be deleted')
  const { error } = await supabase.from('role').delete().eq('id_role', roleId)
  if (error) throw new Error(`Failed to delete role: ${error.message}`)
}
