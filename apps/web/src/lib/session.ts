/** True for an API error that means the login is gone (HTTP 401): the session expired or was ended elsewhere. */
export function isSessionExpired(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { status?: unknown }).status === 401;
}
