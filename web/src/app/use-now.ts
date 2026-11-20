import { useEffect, useState } from 'react'

/** Re-render once in a while so "4 min" keeps counting. */
export function useNow(everyMs: number) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(timer)
  }, [everyMs])
  return now
}
