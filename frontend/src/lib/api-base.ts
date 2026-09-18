/**
 * Works out which FastAPI address the app should call.
 *
 * EXPO_PUBLIC_API_URL is baked into the bundle at build time, so a dev build
 * pinned to `localhost` or yesterday's LAN IP breaks as soon as it is opened
 * from a phone or the laptop's IP changes. For local development we therefore
 * keep the configured port but follow the host the app was actually loaded
 * from (the web page's host, or the Metro host on native). A configured public
 * URL (production) is always used exactly as given.
 */

const DEFAULT_API_URL = "http://localhost:8000";

/** Loopback, link-local, private-LAN, and mDNS hosts only ever mean "a dev machine". */
export function isLocalDevHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  )
    return true;
  if (host === "::1") return true;
  const octets = host.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  )
    return false;
  const [a, b] = octets;
  return (
    a === 127 ||
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254)
  );
}

/**
 * @param configured EXPO_PUBLIC_API_URL as baked into the bundle (may be unset).
 * @param currentHost host the app is running from: the page hostname on web, the
 *   Metro host on native; undefined when unknown.
 */
export function resolveApiBase(
  configured: string | undefined,
  currentHost: string | undefined,
): string {
  const raw = configured?.trim() || DEFAULT_API_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw.replace(/\/+$/, "");
  }
  if (
    currentHost &&
    isLocalDevHost(url.hostname) &&
    isLocalDevHost(currentHost)
  ) {
    url.hostname = currentHost;
  }
  return url.toString().replace(/\/+$/, "");
}
