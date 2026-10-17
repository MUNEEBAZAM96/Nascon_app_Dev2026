const NAMES: Record<string, string> = {
  'demo-t1': 'Alpha',
  'demo-t2': 'Rovers',
  'demo-t3': 'City',
  'demo-t4': 'United',
  'demo-match-1': 'Alpha vs Rovers',
  'demo-match-2': 'City vs United',
  'sq-demo-a': 'Demo United',
  'sq-demo-b': 'Demo Rovers',
  'p-demo-1': 'Demo Striker',
  'demo-league-1': 'Sideline Demo League',
};

const OUTCOMES: Record<string, string> = {
  home_win: 'Home win',
  away_win: 'Away win',
  draw: 'Draw',
  pending: 'Pending',
  undecided: 'Undecided',
};

const ROLES: Record<string, string> = {
  starter: 'Starter',
  substitute: 'Substitute',
  captain: 'Captain',
  vice_captain: 'Vice captain',
};

export function displayName(id: string | null | undefined): string {
  if (!id) return 'Unknown';
  return NAMES[id] ?? id;
}

export function outcomeLabel(outcome: string): string {
  return OUTCOMES[outcome] ?? outcome;
}

export function roleLabel(role: string | null | undefined): string {
  if (!role) return 'None';
  return ROLES[role] ?? role;
}
