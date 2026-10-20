'use strict';

/**
 * The integration suites and the e2e seed run `DROP SCHEMA public CASCADE`. This is the guard in front of that: it throws unless the
 * database looks like a throwaway one (its name contains "test" or "e2e") on this machine, so a typo in `TEST_DB_NAME` or
 * `TEST_DB_HOST` cannot wipe a real database.
 */

const LOCAL_HOSTS = new Set(['', 'localhost', '127.0.0.1', '::1', '[::1]']);

function assertThrowawayDatabase({ name, host }) {
    const db = String(name || '');
    const where = String(host || '').toLowerCase();
    if (!/(test|e2e)/i.test(db)) {
        throw new Error(`Refusing to wipe database "${db}": its name must contain "test" or "e2e".`);
    }
    if (!LOCAL_HOSTS.has(where)) {
        throw new Error(`Refusing to wipe a database on "${host}": tests may only wipe a database on localhost.`);
    }
}

module.exports = { assertThrowawayDatabase };
