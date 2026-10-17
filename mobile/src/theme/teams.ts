const COLORS: Record<string, string> = {
  'demo-t1': '#0B6E4F',
  'demo-t2': '#1D4E89',
  'demo-t3': '#1E3A5F',
  'demo-t4': '#D97706',
};

export function teamColor(id: string | null | undefined): string {
  if (!id) return '#4B5563';
  return COLORS[id] ?? '#4B5563';
}
