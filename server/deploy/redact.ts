/** Journals are diagnostic only; credentials must never enter deploy records or the app. */
export function redact(text: string): string {
  return (
    text
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[private key masked]')
      .replace(/((?:Bearer|Basic)\s+)\S+/gi, '$1[masked]')
      .replace(/(\b(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|credential|code)\b["']?\s*[:=]\s*)(["'])[^\r\n]*?\2/gi, '$1[masked]')
      .replace(/(\b(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|credential|code)\b["']?\s*[:=]\s*)[^\s,;]+/gi, '$1[masked]')
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[masked]@')
      .replace(/[A-Za-z0-9_+/=-]{24,}/g, '[masked]')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip terminal controls from untrusted logs.
      .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
      .slice(-8_000)
  )
}
