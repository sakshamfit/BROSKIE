/**
 * Place / institution affiliation metadata and helpers.
 */
export const AFFILIATION_TYPES = [
  { key: 'institution', label: 'College / Institution', short: 'Institution', icon: 'school-outline' },
  { key: 'organization', label: 'Organization', short: 'Organization', icon: 'people-outline' },
  { key: 'workplace', label: 'Workplace', short: 'Workplace', icon: 'construct-outline' },
];

export function affiliationType(typeKey) {
  return AFFILIATION_TYPES.find((item) => item.key === typeKey) || AFFILIATION_TYPES[0];
}
