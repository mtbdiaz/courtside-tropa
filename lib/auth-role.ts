export const SCORER_EMAIL = 'scorer@tropaocaso.com';

function normalizeEmail(email: string | null | undefined) {
  return (email ?? '').trim().toLowerCase();
}

export function isScorerEmail(email: string | null | undefined) {
  return normalizeEmail(email) === SCORER_EMAIL;
}

export function resolvePostLoginPath(email: string | null | undefined, fallbackPath: string) {
  if (isScorerEmail(email)) {
    return '/dashboard/score';
  }

  return fallbackPath;
}
