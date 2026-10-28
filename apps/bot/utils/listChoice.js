/**
 * Picking a list from a slash command option. Autocomplete offers each list by name, except a name that more than one of
 * your lists shares (your own "Work" and one shared with you), which is offered as `#<id>` with the owner in the label, so
 * choosing it picks that list and not whichever the name lookup finds first. `findList` reads either form back.
 */

'use strict';

const { tasks } = require('@taskquest/shared/db');

const ID_VALUE = /^#(\d{1,12})$/;

/** The menu entries (at most 25) for `lists` that pass `keep` and whose name contains `q` (lower case). */
function autocompleteChoices(lists, keep, q) {
    const seen = new Map();
    for (const l of lists) seen.set(l.name, (seen.get(l.name) || 0) + 1);
    return lists
        .filter((l) => keep(l) && l.name.toLowerCase().includes(q))
        .slice(0, 25)
        .map((l) => {
            if (seen.get(l.name) > 1) {
                const who = l.is_owner ? 'yours' : `by ${l.owner_name || 'someone'}`;
                return { name: `${l.name.slice(0, 80)} (${who})`.slice(0, 100), value: `#${l.id}` };
            }
            return { name: l.name.slice(0, 100), value: l.name.slice(0, 100) };
        });
}

/** The list an option value names: `#<id>` from autocomplete, or a typed name. Null when the user cannot see it. */
async function findList(discordId, value) {
    const text = String(value || '');
    const byId = ID_VALUE.exec(text);
    return byId ? tasks.getList(discordId, byId[1]) : tasks.getListByName(discordId, text);
}

module.exports = { autocompleteChoices, findList, ID_VALUE };
