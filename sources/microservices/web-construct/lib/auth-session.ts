import { cache } from 'react'
import { auth } from '@/lib/auth'

/**
 * La sessione della richiesta, letta una volta sola (specifica 2026-10-15, §2.1, MTP-DEC-4): ogni
 * auth() fa girare il callback jwt, che rilegge l'autorizzazione dal database. cache() di React
 * vale solo dentro una richiesta, quindi una revoca vale dalla richiesta successiva. Fuori dal
 * rendering (route, azioni) non memorizza: lì la sessione si legge comunque una volta.
 */
export const getSession = cache(async () => auth())
