/** The reply the bot is writing, which may sit above messages sent while it was written. Pure functions only. */
import type { ViewItem } from './chat-state'

export const writing = (items: readonly ViewItem[]) => items.map(item => item.kind === 'assistant' && item.streaming).lastIndexOf(true)
export const replaced = (items: readonly ViewItem[], at: number, item: ViewItem) => items.map((old, i) => (i === at ? item : old))
export const stopWriting = (items: ViewItem[]): ViewItem[] => items.map(item => (item.kind === 'assistant' && item.streaming ? { ...item, streaming: false } : item))
