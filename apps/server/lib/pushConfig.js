/** Validation of the optional web push settings (kept apart from lib/push.js so config.js can use it without a cycle). */

/** VAPID settings problems (empty when push is off or fully configured). All three values or none. */
export function pushConfigProblems(push) {
    const set = [push.publicKey, push.privateKey, push.subject].filter(Boolean).length;
    if (set === 0) return [];
    const problems = [];
    if (set < 3) problems.push('WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY and WEB_PUSH_SUBJECT must all be set, or none of them (generate keys with: npx web-push generate-vapid-keys).');
    else {
        if (!/^[A-Za-z0-9_-]{80,100}$/.test(push.publicKey)) problems.push('WEB_PUSH_PUBLIC_KEY is not a VAPID public key (base64url, about 87 characters).');
        if (!/^[A-Za-z0-9_-]{40,60}$/.test(push.privateKey)) problems.push('WEB_PUSH_PRIVATE_KEY is not a VAPID private key (base64url, about 43 characters).');
        if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(push.subject)) problems.push('WEB_PUSH_SUBJECT must be a mailto: address or an https URL.');
    }
    if (push.internalToken && push.internalToken.length < 32) problems.push('WEB_PUSH_INTERNAL_TOKEN must be at least 32 characters.');
    return problems;
}
