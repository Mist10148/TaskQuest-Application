/**
 * Text that comes from other people (a list name, a party name, a display name) must never be able to change how a Discord
 * message looks or reach anybody: a list called "[Click here to claim your prize](https://evil.example)" or "@everyone" must show
 * as plain text inside an invitation, and a bare link must not turn into a clickable one.
 */

'use strict';

const ZWSP = '\u200b'; // zero-width space: invisible, breaks mention, link and domain detection

/**
 * Make untrusted text safe to put inside a Discord message or embed.
 *   - control characters, newlines and invisible or bidirectional formatting characters become a space or vanish
 *   - markdown is escaped (backslash * _ ~ ` > | [ ] ( ) # <)
 *   - every @ is followed by a zero-width space, so @everyone, @here and <@id> / <@&id> mentions are plain text
 *   - links are neutralised: "://" and a dot inside a domain-looking word get a zero-width space, so nothing autolinks
 * Pair it with `allowedMentions: { parse: [] }` on the send, which stops pings even if something slipped through.
 * @param {unknown} value
 * @param {{ max?: number }} [options] `max` shortens the text (in characters) before escaping
 * @returns {string}
 */
function escapeDiscord(value, { max = 0 } = {}) {
    let s = String(value ?? '');
    s = s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ');
    s = s.replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, '');
    s = s.trim();
    if (max > 0) {
        const chars = [...s];
        if (chars.length > max) s = `${chars.slice(0, Math.max(0, max - 1)).join('')}…`;
    }
    s = s.replace(/:\/\//g, `:${ZWSP}//`);
    s = s.replace(/([A-Za-z0-9])\.(?=[A-Za-z0-9])/g, `$1.${ZWSP}`);
    s = s.replace(/@/g, `@${ZWSP}`);
    return s.replace(/[\\*_~`>|[\]()#<]/g, '\\$&');
}

module.exports = { escapeDiscord };
