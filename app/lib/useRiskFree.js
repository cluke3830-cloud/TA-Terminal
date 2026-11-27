'use client';
import { useEffect, useState } from 'react';

// Today's 3-month Treasury yield, for the pricers' default rate.
// status: 'loading' | 'live' | 'unavailable'
export function useRiskFree() {
  const [info, setInfo] = useState({ rate: null, asOf: null, source: null, status: 'loading' });
  useEffect(() => {
    let off = false;
    fetch('/data_pages/macro/riskfree')
      .then((r) => r.json())
      .then((j) => {
        if (off) return;
        if (typeof j?.rate === 'number') setInfo({ rate: j.rate, asOf: j.asOf, source: j.source, status: 'live' });
        else setInfo((s) => ({ ...s, status: 'unavailable' }));
      })
      .catch(() => { if (!off) setInfo((s) => ({ ...s, status: 'unavailable' })); });
    return () => { off = true; };
  }, []);
  return info;
}

export function riskFreeHint(rf) {
  if (rf.status === 'live') return `Today's 3-month Treasury yield: ${(rf.rate * 100).toFixed(2)}% (as of ${rf.asOf}). Type over it to use another rate.`;
  if (rf.status === 'loading') return "Loading today's 3-month Treasury yield…";
  return 'The live Treasury rate could not be loaded. Type a rate to continue.';
}
