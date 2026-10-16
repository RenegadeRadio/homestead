import { useEffect, useState } from "react";

// The current time, held in state so render stays pure (react-hooks/purity), refreshed every minute so
// time-based views (expiry, pause notices) still update while the page is open.
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
