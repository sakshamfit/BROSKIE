/**
 * Shared metadata for Community categories — purpose-based groups on The
 * Network (club nights, house parties, chai chats, trip planning, running
 * groups, etc). Kept in one place so the discover grid, the composer, and
 * the detail header all agree on icon/label/tint.
 */
export const CATEGORY = {
  club: { key: 'club', label: 'Club Night', icon: 'moon-outline', blurb: 'Going out, dancing, late nights' },
  party: { key: 'party', label: 'House Party', icon: 'sparkles-outline', blurb: 'Hosting or crashing a house party' },
  chai: { key: 'chai', label: 'Chai Chat', icon: 'cafe-outline', blurb: 'Casual hangouts, coffee & chai runs' },
  trip: { key: 'trip', label: 'Trip Planning', icon: 'airplane-outline', blurb: 'Weekend getaways, road trips' },
  run: { key: 'run', label: 'Running Group', icon: 'walk-outline', blurb: 'Runs, jogs, morning workouts' },
  game: { key: 'game', label: 'Game Night', icon: 'game-controller-outline', blurb: 'Board games, video games, sports' },
  study: { key: 'study', label: 'Study Group', icon: 'school-outline', blurb: 'Study sessions, project work' },
  custom: { key: 'custom', label: 'Something Else', icon: 'apps-outline', blurb: 'Anything that does not fit above' },
};

export const CATEGORY_LIST = Object.values(CATEGORY);

export function categoryMeta(key) {
  return CATEGORY[key] || CATEGORY.custom;
}

export const JOIN_POLICY = {
  open: { key: 'open', label: 'Open', icon: 'earth-outline', blurb: 'Anyone can join instantly' },
  request: { key: 'request', label: 'Ask to join', icon: 'hourglass-outline', blurb: 'Admin approves each request' },
  invite: { key: 'invite', label: 'Invite only', icon: 'lock-open-outline', blurb: 'Admin must add people directly' },
};

export const JOIN_POLICY_LIST = Object.values(JOIN_POLICY);
