// Small formatting helpers shared by the screens.

export function ago(ts: number | null | undefined) {
  if (ts == null) return 'never';
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return `${Math.round(s)} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** Short label for a leaf-check verdict. */
export function verdictWord(v: string) {
  return (
    {
      healthy: 'Looks healthy',
      'needs attention': 'Needs attention',
      'no plant in view': 'No plant in view',
      uncertain: 'Not sure: reframe',
      'uncertain (lighting)': 'Not sure: lighting',
      'analysis failed': 'Analysis failed',
    }[v] ?? v
  );
}
