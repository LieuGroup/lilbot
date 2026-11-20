/** Goals (#143): Oscar gives an outcome once, in his words; the bot proposes an agreement and a target measured from a real
 *  source; once he agrees, the bot works on the board and LilBot's review routine reports against the target on a rhythm.
 *  A goal belongs to one bot. The bot promises the work and measures the number honestly; it does not promise the number. */
import { z } from 'zod'
import { RoutineSchedule } from './routine-schema'
import { EvidenceInput, type EvidencePointer, type WorkSummary } from './work-schema'

/** proposed: waits for Oscar, nothing is done for it. agreed: worked on, reviewed on its rhythm. paused: by Oscar, the review
 *  too. reached: a review that met the target was checked and done. dropped: by Oscar, or with its bot. The last two are final. */
const GOAL_STATES = ['proposed', 'agreed', 'paused', 'reached', 'dropped'] as const
export type GoalState = (typeof GOAL_STATES)[number]

/** What the bot can do alone, what it needs from Oscar (access, money, a decision) and what it cannot influence. */
interface GoalAgreement {
  alone: string[]
  needsOscar: string[]
  cannotInfluence: string[]
}
/** A number and a date: what is counted, where it is read, where it stood when proposed and where it should be by `due`. */
export interface GoalTarget {
  measure: string
  source: string
  baseline: { value: number; at: number; evidence: EvidencePointer }
  value: number
  /** YYYY-MM-DD. */
  due: string
}
/** A change the bot proposed to an agreed goal, waiting for Oscar: a new agreement, target or rhythm, or dropping it. */
export interface GoalProposal {
  agreement: GoalAgreement | null
  target: GoalTarget | null
  review: RoutineSchedule | null
  drop: boolean
  why: string
  at: number
}
/** One review: the number against the previous one and the target, worked out by LilBot, and what the bot did, in its words.
 *  `stalled`: not met, and nothing moved toward the target in this and the previous review, or the due date passed. */
export interface GoalReview {
  at: number
  value: number
  /** The previous review's value, or the baseline. */
  previous: number
  moved: 'toward' | 'away' | 'none'
  met: boolean
  stalled: boolean
  did: string
  /** The goal's work items when the review was made. */
  work: { done: number; open: number; needsOscar: number; failed: number }
  /** The review's work item, with its evidence. */
  itemId: string
}
export interface GoalEvent {
  at: number
  by: 'bot' | 'oscar' | 'lilbot'
  kind: 'proposed' | 'agreed' | 'adjusted' | 'change' | 'paused' | 'reviewed' | 'reached' | 'dropped'
  text: string | null
}
export interface Goal {
  id: string
  botId: string
  /** The bot's name when the goal was proposed, kept after the bot is deleted. */
  botName: string
  /** Oscar's words. */
  text: string
  state: GoalState
  agreement: GoalAgreement
  target: GoalTarget
  review: RoutineSchedule
  reviewText: string
  /** The review routine LilBot made when Oscar agreed; null before, and after the goal ends. */
  routineId: string | null
  proposal: GoalProposal | null
  /** Oscar's latest adjustment, until the bot proposes again. */
  oscar: string | null
  /** A proposed goal or a proposed change waits for Oscar: agree, adjust or drop. */
  waitsForOscar: boolean
  latest: GoalReview | null
  dropReason: string | null
  createdAt: number
  updatedAt: number
  agreedAt: number | null
  finishedAt: number | null
}
export interface GoalDetail extends Goal {
  reviews: GoalReview[]
  items: WorkSummary[]
  events: GoalEvent[]
}

const text = (max: number) => z.string().trim().min(1).max(max)
const goalId = z.string().min(1).max(100)
const lines = z.array(text(300)).max(10)

const GoalAgreementInput = z.object({ alone: lines.min(1), needsOscar: lines, cannotInfluence: lines })
const GoalTargetInput = z.object({
  measure: text(200).describe('What is counted'),
  source: text(500).describe('Where you read it: a path, page or command'),
  baseline: z.number().describe('The value you read from the source now'),
  evidence: EvidenceInput.describe('How you read the baseline'),
  value: z.number(),
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
})
export type GoalTargetInput = z.infer<typeof GoalTargetInput>

/** The bot's one goal tool. propose: a new goal (Oscar's words, from his conversation), a new version of a proposed goal, or a
 *  change to an agreed one. progress: a review of an agreed goal. */
export const GoalInput = z.object({
  action: z.enum(['propose', 'progress']),
  requestId: z.string().min(1).max(100),
  goalId: goalId.optional(),
  text: text(2000).optional().describe("A new goal: Oscar's words"),
  agreement: GoalAgreementInput.optional(),
  target: GoalTargetInput.optional(),
  review: RoutineSchedule.optional().describe('Review rhythm, default weekly'),
  drop: z.boolean().optional().describe('Propose dropping an agreed goal'),
  why: text(1000).optional().describe('Why the change'),
  value: z.number().optional().describe('progress: the measure as you read it now'),
  did: text(2000).optional().describe('progress: what you did of what you said you would'),
  evidence: z.array(EvidenceInput).min(1).max(5).optional().describe('progress: how you read the value')
})
export type GoalInput = z.infer<typeof GoalInput>

/** Goals on the bot's read tool (`lilbot_work_list`). */
export const GoalReadInput = z.object({
  goals: z.boolean().optional().describe('Goals instead of items'),
  goalId: goalId.optional().describe('One goal in full, with its items and reviews')
})

/** Oscar's browser methods (joined into `shared/protocol.ts`); `goals.changed` is pushed when any goal changes. */
export const goalMethods = {
  'goals.list': z.object({ botId: z.string().min(1).optional(), state: z.array(z.enum(GOAL_STATES)).max(5).optional() }),
  'goals.open': z.object({ goalId }),
  /** A proposed goal starts (LilBot makes its review routine), a paused one resumes, a proposed change applies. `review`
   *  sets the rhythm instead of the bot's. */
  'goals.agree': z.object({ goalId, review: RoutineSchedule.optional() }),
  /** Oscar's answer in his words instead of agreeing; the bot proposes again. */
  'goals.adjust': z.object({ goalId, text: text(4000) }),
  'goals.pause': z.object({ goalId }),
  /** Ends the goal: its review routine is removed and its unfinished work items are dropped. */
  'goals.drop': z.object({ goalId, reason: text(1000).optional() })
} as const
export interface GoalResults {
  'goals.list': Goal[]
  'goals.open': GoalDetail
  'goals.agree': GoalDetail
  'goals.adjust': GoalDetail
  'goals.pause': GoalDetail
  'goals.drop': GoalDetail
}
