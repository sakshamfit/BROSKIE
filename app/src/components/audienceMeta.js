/**
 * Audience metadata constants for Network posts and Status updates.
 */
export const AUDIENCE = {
  public: { key: 'public', label: 'Public', sub: 'Everyone on +one can see this', icon: 'earth-outline' },
  places: { key: 'places', label: 'My places', sub: 'People who share your college or workplace', icon: 'school-outline' },
  contacts: { key: 'contacts', label: 'Friends', sub: 'Only people you already chat with', icon: 'people-outline' },
  contacts_except: { key: 'contacts_except', label: 'Friends except…', sub: 'All friends except the people you choose', icon: 'person-remove-outline' },
  selected: { key: 'selected', label: 'Private', sub: 'Only the people you choose can see it', icon: 'lock-closed-outline' },
};

export const DEFAULT_AUDIENCE_OPTIONS = ['public', 'places', 'contacts', 'selected'];
