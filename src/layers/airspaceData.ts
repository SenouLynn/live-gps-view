export const airspaceKinds = ['ceilings', 'restrictions', 'sites'] as const;
export type AirspaceKind = typeof airspaceKinds[number];
export function airspaceLabel(kind: AirspaceKind, properties: Record<string, unknown>): { text: string; color: string } {
  if (kind === 'sites') return { text: String(properties.SITE_NAME || 'Recreational fixed site'), color: '#9fe8c6' };
  if (kind === 'restrictions') return { text: String(properties.Facility || properties.Base || 'Security restriction'), color: '#ff647c' };
  const value = properties.CEILING;
  const unit = String(properties.UNIT ?? '').toLowerCase();
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !['ft', 'feet'].includes(unit))
    return { text: 'Ceiling unknown', color: '#a6aeb5' };
  return { text: `${value} ft AGL`, color: value === 0 ? '#ff9770' : '#ffd166' };
}
