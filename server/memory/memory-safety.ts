/** What may not be stored as a memory fact. A fact is shown to bots on every future turn, so one
 *  that carries instructions for the model, or a secret, would do harm for as long as it lives.
 *  The same idea as Hermes' scan of its own memory files. */

interface Rule {
  pattern: RegExp
  reason: string
}

const rules: Rule[] = [
  // Text addressed to the model instead of describing the user or the work.
  {
    pattern: /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|your)\b[^.\n]{0,30}\b(instructions?|rules?|prompts?|guidelines?)\b/i,
    reason: 'it reads as an instruction to override your rules'
  },
  { pattern: /\b(system prompt|developer message|hidden instructions?)\b/i, reason: 'it refers to the system prompt' },
  { pattern: /\byou are now\b|\bfrom now on you (are|must|will)\b|\bact as (an?|the) (unrestricted|jailbroken|different)\b/i, reason: 'it tries to redefine who you are' },
  { pattern: /\bdo not (tell|inform|mention|reveal)[^.\n]{0,30}\b(user|owner|oscar)\b/i, reason: 'it asks to hide something from the user' },
  // Secrets.
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, reason: 'it contains a private key' },
  {
    pattern: /\b(sk|pk|rk)-[A-Za-z0-9_-]{20,}|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
    reason: 'it contains what looks like an access key or token'
  },
  { pattern: /\b(pass(word|wd|phrase)?|secret|api[_ -]?key|token)\b\s*(is|=|:)\s*\S{6,}/i, reason: 'it contains what looks like a password or key' },
  // Sending data out, or running fetched code.
  { pattern: /\b(curl|wget)\b[^\n]{0,80}\|\s*(ba|z)?sh\b/i, reason: 'it contains a command that runs downloaded code' },
  // Characters that hide or reorder text.
  { pattern: /[​-‏‪-‮⁠-⁤﻿]/, reason: 'it contains invisible characters' }
]

/** Why this text may not be stored, or null when it is fine. */
export function memoryRefusal(text: string): string | null {
  const hit = rules.find(rule => rule.pattern.test(text))
  return hit ? `That was not saved: ${hit.reason}. Save plain facts about the user or the work, never instructions or secrets.` : null
}
