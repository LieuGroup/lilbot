/** Connections LilBot supplies to every bot. Today only T3 Code, for coding work. */
export type T3ConnectionState = 'connected' | 'missing' | 'expired' | 'revoked'

/** The state of LilBot's one T3 Code sign-in. Never carries the credential itself. */
export interface T3ConnectionStatus {
  state: T3ConnectionState
  /** When the approval stops working (milliseconds since the epoch). */
  expiresAt?: number
  /** The name T3 Code shows for LilBot under Sharing & access. */
  label?: string
}

export interface ConnectionsStatus {
  t3: T3ConnectionStatus
}
