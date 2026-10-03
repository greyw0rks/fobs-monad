// Outbound HTTP helper. A single retry on a *network* failure (never on an HTTP
// status) — Node's fetch keeps connections alive, and a pooled connection the
// peer has since closed surfaces as "fetch failed", which would otherwise show
// up as a missing price or a failed quote on an otherwise healthy request.

const RETRY_DELAY_MS = 150;

export async function fetchWithRetry(url: string, init: RequestInit, attempts = 2): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
      }
    }
  }
  throw lastError;
}
