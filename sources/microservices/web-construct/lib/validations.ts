import { z } from 'zod'

/**
 * Message *keys*, so a caller that has a translator can render these in the
 * user's language. The schemas below keep the literal Italian text as their
 * default so server-side callers with no React context still produce a
 * readable message.
 */
export const VALIDATION_KEYS = {
  passwordMinLength: 'validation.password.min_length',
  passwordUppercase: 'validation.password.uppercase',
  passwordDigit: 'validation.password.digit',
  emailInvalid: 'validation.email.invalid',
  phoneInvalid: 'validation.phone.invalid',
} as const

export const passwordSchema = z
  .string()
  .min(8, 'La password deve contenere almeno 8 caratteri.')
  .regex(/[A-Z]/, 'La password deve contenere almeno una lettera maiuscola.')
  .regex(/[0-9]/, 'La password deve contenere almeno un numero.')

export const emailSchema = z.string().email('Email non valida.').toLowerCase().trim()

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{1,14}$/, 'Numero di telefono non valido. Usa il formato internazionale, es. +391234567890.')
