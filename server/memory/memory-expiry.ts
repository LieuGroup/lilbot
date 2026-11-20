import { z } from 'zod'

/** A date like 2026-12-31: a fact with that expiry is shown through the whole named day (UTC). */
export const expiryDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-31.')
export const endOfDay = (day: string) => Date.parse(`${day}T23:59:59Z`)
