/**
 * Parses TRUST_PROXY into a value Express's `trust proxy` setting accepts:
 * true/false, a hop count, or a comma-separated list of subnets/keywords.
 * Returns { value, error } so a typo fails startup instead of silently
 * trusting no proxy (which breaks secure cookies and shares one rate-limit
 * bucket across every user behind the proxy).
 */
const KEYWORDS = new Set(['loopback', 'linklocal', 'uniquelocal']);
const ADDRESS = /^[0-9a-f:.]+(\/\d{1,3})?$/i;

export function parseTrustProxy(raw, fallback) {
    if (raw === undefined) return { value: fallback };
    const text = String(raw).trim();
    if (text === '') return { value: fallback };
    const lower = text.toLowerCase();
    if (lower === 'true') return { value: true };
    if (lower === 'false') return { value: false };
    if (/^\d+$/.test(text)) return { value: Number(text) };
    const parts = text.split(',').map((s) => s.trim());
    if (parts.every((p) => KEYWORDS.has(p.toLowerCase()) || (ADDRESS.test(p) && (p.includes('.') || p.includes(':'))))) {
        return { value: parts.join(',') };
    }
    return { value: fallback, error: `TRUST_PROXY must be true, false, a hop count, or a list of subnets (got "${text}").` };
}
