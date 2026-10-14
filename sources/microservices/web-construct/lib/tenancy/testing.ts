import { toTenantId, type TenantId } from './tenant-id'

/** Solo per i test: il tenant predefinito, quello che esiste in ogni database di test. */
export function defaultTestTenant(): TenantId {
  return toTenantId(1)
}

/** Solo per i test: un tenant creato da un fixture (Task 10). */
export function tenantIdForTest(id: number): TenantId {
  return toTenantId(id)
}
