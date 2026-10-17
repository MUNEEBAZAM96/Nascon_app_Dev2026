export interface TenantTheme {
  name: string;
  primary: string;
  secondary: string;
}

const TENANT_THEMES: Record<string, TenantTheme> = {
  'tenant-alpha': { name: 'Alpha Sports', primary: '#0B6E4F', secondary: '#E8F5E9' },
  'tenant-beta': { name: 'Beta Athletics', primary: '#1D4E89', secondary: '#E3F2FD' },
};

const DEFAULT_THEME: TenantTheme = { name: 'Sideline', primary: '#1F2937', secondary: '#F3F4F6' };

export function tenantTheme(tenantId: string | null | undefined): TenantTheme {
  return (tenantId && TENANT_THEMES[tenantId]) || DEFAULT_THEME;
}

export const colors = {
  text: '#111827',
  muted: '#4B5563',
  background: '#F3F6F4',
  card: '#FFFFFF',
  surface: '#F9FAFB',
  border: '#E5E7EB',
  danger: '#B91C1C',
  online: '#047857',
  offline: '#B91C1C',
  syncing: '#B45309',
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24 };
export const minTapTarget = 48;
