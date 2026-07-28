import { z } from 'zod'

/**
 * The §2.3 invariants that a single row can decide on its own. "Exactly one
 * default" and code/locale uniqueness are enforced by the database
 * (`app_language_single_default`, the UNIQUE columns) — the source of truth for
 * a rule that spans rows must be the one place that sees all of them.
 */
export interface LanguageRuleRow {
  isDefault: boolean
  isActive: boolean
  /** Number of translation values attached — informational, never blocking. */
  usageCount: number
}

export const languageInputSchema = z.object({
  code: z.string().trim().toLowerCase().regex(/^[a-z]{2,3}$/, 'Codice lingua non valido. Usa 2 o 3 lettere minuscole, es. it.'),
  locale: z.string().trim().regex(/^[a-z]{2,3}-[A-Z]{2}$/, 'Locale non valido. Usa il formato ll-CC, es. it-IT.'),
  name: z.string().trim().min(1, 'Il nome è obbligatorio.').max(80, 'Massimo 80 caratteri.'),
  nativeName: z.string().trim().min(1, 'Il nome nativo è obbligatorio.').max(80, 'Massimo 80 caratteri.'),
  isActive: z.boolean(),
})

export type LanguageInput = z.infer<typeof languageInputSchema>

export function assertCanDeactivate(row: LanguageRuleRow): void {
  if (row.isDefault) throw new Error('Non è possibile disattivare la lingua predefinita.')
}

export function assertCanDelete(row: LanguageRuleRow): void {
  if (row.isDefault) throw new Error('Non è possibile eliminare la lingua predefinita.')
}

export function assertCanSetDefault(row: LanguageRuleRow): void {
  if (!row.isActive) throw new Error('Solo una lingua attiva può diventare predefinita.')
}
