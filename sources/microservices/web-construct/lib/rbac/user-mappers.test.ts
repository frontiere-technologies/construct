import { describe, it, expect } from 'vitest'
import { USER_SORT_COLUMN, mapUserStatus, buildUserDtos, type UserRow, type UserRoleRow } from './user-mappers'

describe('USER_SORT_COLUMN', () => {
  it('maps DTO sort fields to db columns', () => {
    expect(USER_SORT_COLUMN.firstName).toBe('first_name')
    expect(USER_SORT_COLUMN.dateIns).toBe('created_at')
    expect(USER_SORT_COLUMN.dateMod).toBe('updated_at')
    expect(USER_SORT_COLUMN.status).toBe('id_user_status')
    expect(USER_SORT_COLUMN.email).toBe('email')
  })
})

describe('mapUserStatus', () => {
  it('maps 2 to Active', () => { expect(mapUserStatus(2)).toEqual({ idUserStatus: 2, description: 'Active' }) })
  it('maps 1 (and anything else) to Deactivated', () => {
    expect(mapUserStatus(1)).toEqual({ idUserStatus: 1, description: 'Deactivated' })
    expect(mapUserStatus(0)).toEqual({ idUserStatus: 1, description: 'Deactivated' })
  })
})

describe('buildUserDtos', () => {
  const userRows: UserRow[] = [
    { id: 'u1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@x.io', created_at: '2026-01-01T00:00:00Z', updated_at: null, id_user_status: 2 },
    { id: 'u2', first_name: null, last_name: null, email: 'bob@x.io', created_at: '2026-01-02T00:00:00Z', updated_at: '2026-02-01T00:00:00Z', id_user_status: 1 },
  ]
  const userRoleRows: UserRoleRow[] = [
    { user_id: 'u1', id_role: 0 }, { user_id: 'u1', id_role: 1 }, { user_id: 'u2', id_role: 0 },
  ]
  const roleNameById = new Map<number, string>([[0, 'Registered user'], [1, 'Administrator']])
  const dtos = buildUserDtos(userRows, userRoleRows, roleNameById)

  it('builds one DTO per user row, in order', () => {
    expect(dtos.map(d => d.id)).toEqual(['u1', 'u2'])
  })
  it('aggregates roles (sorted by id) with names', () => {
    expect(dtos[0].roles).toEqual([{ id: 0, name: 'Registered user' }, { id: 1, name: 'Administrator' }])
    expect(dtos[1].roles).toEqual([{ id: 0, name: 'Registered user' }])
  })
  it('maps status and constant tenancy flags', () => {
    expect(dtos[0].status).toEqual({ idUserStatus: 2, description: 'Active' })
    expect(dtos[1].status).toEqual({ idUserStatus: 1, description: 'Deactivated' })
    expect(dtos[0].tenantValidationPending).toBe(false)
    expect(dtos[0].multiTenancyEnabled).toBe(false)
  })
  it('falls back to the role id as name when unknown', () => {
    const d = buildUserDtos([userRows[0]], [{ user_id: 'u1', id_role: 99 }], new Map())
    expect(d[0].roles).toEqual([{ id: 99, name: '99' }])
  })
})
