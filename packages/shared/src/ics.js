/**
 * iCalendar (RFC 5545) feed of deadlines and due dates. Pure: give it rows, get
 * text. Every event is an all-day event on the plain date, so the day never
 * shifts with the viewer's time zone.
 */

'use strict';

const pad = (n) => String(n).padStart(2, '0');

/** "2030-01-31" -> "20300131". */
const compact = (ymd) => String(ymd).slice(0, 10).replace(/-/g, '');

/** The day after a YYYY-MM-DD date (all-day events end on the next day, exclusive). */
function nextDay(ymd) {
    const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    return `${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`;
}

/** Escape a TEXT value: backslash, semicolon, comma and newlines. */
function escapeText(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r\n|\r|\n/g, '\\n');
}

/** Fold a content line at 75 octets, continuing with CRLF + space (never splitting a UTF-8 character). */
function fold(line) {
    const out = [];
    let current = '';
    let bytes = 0;
    for (const ch of line) {
        const size = Buffer.byteLength(ch);
        if (bytes + size > (out.length ? 74 : 75)) {
            out.push(current);
            current = '';
            bytes = 0;
        }
        current += ch;
        bytes += size;
    }
    out.push(current);
    return out.join('\r\n ');
}

function stamp(now) {
    return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
}

/**
 * @param {object} data
 * @param {Array<{ id: number, name: string, deadline: string, description?: string, category?: string, completed?: boolean }>} data.lists lists with a deadline
 * @param {Array<{ id: number, name: string, due_date: string, list_name?: string, description?: string, completed?: boolean }>} data.items items with a due date
 * @param {Date} [data.now]
 * @param {string} [data.calendarName]
 * @returns {string} CRLF-separated iCalendar text
 */
function buildIcs({ lists = [], items = [], now = new Date(), calendarName = 'TaskQuest' } = {}) {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//TaskQuest//Deadlines//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:${escapeText(calendarName)}`
    ];
    const dtstamp = stamp(now);
    const event = ({ uid, date, summary, description, categories, done }) => {
        lines.push(
            'BEGIN:VEVENT',
            `UID:${uid}@taskquest`,
            `DTSTAMP:${dtstamp}`,
            `DTSTART;VALUE=DATE:${compact(date)}`,
            `DTEND;VALUE=DATE:${nextDay(date)}`,
            `SUMMARY:${escapeText(`${done ? '✓ ' : ''}${summary}`)}`
        );
        if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
        if (categories) lines.push(`CATEGORIES:${escapeText(categories)}`);
        lines.push('TRANSP:TRANSPARENT', 'END:VEVENT');
    };

    for (const l of lists) {
        if (!l.deadline) continue;
        event({ uid: `list-${l.id}`, date: l.deadline, summary: `Due: ${l.name}`, description: l.description, categories: l.category, done: l.completed });
    }
    for (const i of items) {
        if (!i.due_date) continue;
        event({
            uid: `item-${i.id}`,
            date: i.due_date,
            summary: i.name,
            description: [i.list_name ? `List: ${i.list_name}` : '', i.description || ''].filter(Boolean).join('\n'),
            done: i.completed
        });
    }
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { buildIcs, escapeText, fold };
