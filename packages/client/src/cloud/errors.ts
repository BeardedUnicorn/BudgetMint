// Adapted from TaskMint packages/client/src/cloud/errors.ts @ 1623bee.
/**
 * Firebase’s errors in the user’s words. Its own messages
 * ("Firebase: Error (auth/invalid-credential).") name a code, not a fix.
 */

const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'That email and password don’t match an account.',
  'auth/invalid-email': 'That isn’t an email address.',
  'auth/user-disabled': 'This account has been turned off.',
  'auth/email-already-in-use': 'There’s already an account with that email. Sign in instead.',
  'auth/weak-password': 'Choose a password of at least 6 characters.',
  'auth/missing-password': 'Enter your password.',
  'auth/too-many-requests': 'Too many tries. Wait a few minutes, then try again.',
  'auth/network-request-failed': 'Can’t reach Firebase. Check the connection and try again.',
  'auth/popup-closed-by-user': 'Google sign-in was closed before it finished.',
  'auth/popup-blocked': 'The browser blocked Google’s sign-in window. Allow pop-ups for this site.',
  'auth/account-exists-with-different-credential':
    'This email’s account signs in another way. Sign in that way instead.',
  'auth/requires-recent-login': 'Sign in again first, then try once more.',
  'permission-denied': 'The cloud refused that change. Sign out and in again.',
  unavailable: 'Can’t reach the cloud. Changes are saved here and go once it’s back.',
  // The Firebase project is on a free plan, shared with TaskMint
  'resource-exhausted': 'The cloud’s limit for today is used up. Try again later: it resets each day.',
  unauthenticated: 'Your sign-in has run out. Sign out and in again.',
  'deadline-exceeded': 'The cloud took too long to answer. Check the connection and try again.',
};

/** Where reading the data (not saving a change) needs other words. */
const READING: Record<string, string> = {
  'permission-denied': 'The cloud won’t let this account read its data. Sign out and in again.',
  unavailable: 'Can’t reach the cloud. Check the connection and try again.',
};

/** `error` in the user's words: as it came from saving a change, or (`reading`) from reading the data. */
export function cloudErrorMessage(error: unknown, { reading = false } = {}): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string') {
    if (reading && code in READING) return READING[code];
    if (code in MESSAGES) return MESSAGES[code];
  }
  return error instanceof Error ? error.message : String(error);
}
