import { z } from 'zod'

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
