/**
 * express-session store backed by the `web_sessions` table (migration 001_baseline),
 * using the shared database pool.
 */

import session from 'express-session';

/**
 * Settle `promise` into a node-style callback, called outside the promise chain (as express-session's MemoryStore defers its
 * callbacks): an error thrown by `cb` then surfaces as an ordinary exception instead of an unhandled rejection that leaves the
 * request hanging.
 */
function settle(promise, cb) {
    promise.then(
        (value) => setImmediate(cb, null, value),
        (err) => setImmediate(cb, err)
    );
}

export class DbSessionStore extends session.Store {
    /**
     * @param {{ query: Function }} pool the shared pool (packages/shared/src/db/pool.js)
     * @param {{ ttlMs: number, cleanupIntervalMs?: number }} options
     */
    constructor(pool, { ttlMs, cleanupIntervalMs = 15 * 60 * 1000 }) {
        super();
        this.pool = pool;
        this.ttlMs = ttlMs;
        this.cleanupTimer = setInterval(() => this.clearExpired().catch(() => {}), cleanupIntervalMs);
        this.cleanupTimer.unref();
    }

    expiresAt(sess) {
        const ms = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + this.ttlMs;
        return Math.floor(ms / 1000);
    }

    get(sid, cb) {
        settle(
            this.pool
                .query('SELECT data FROM web_sessions WHERE session_id = ? AND expires >= ?', [sid, Math.floor(Date.now() / 1000)])
                .then(([rows]) => (rows[0] ? JSON.parse(rows[0].data) : null)),
            cb
        );
    }

    set(sid, sess, cb = () => {}) {
        settle(
            this.pool
                .query(
                    `INSERT INTO web_sessions (session_id, expires, data) VALUES (?, ?, ?)
                     ON CONFLICT (session_id) DO UPDATE SET expires = EXCLUDED.expires, data = EXCLUDED.data`,
                    [sid, this.expiresAt(sess), JSON.stringify(sess)]
                )
                .then(() => undefined),
            cb
        );
    }

    touch(sid, sess, cb = () => {}) {
        settle(
            this.pool.query('UPDATE web_sessions SET expires = ? WHERE session_id = ?', [this.expiresAt(sess), sid]).then(() => undefined),
            cb
        );
    }

    destroy(sid, cb = () => {}) {
        settle(
            this.pool.query('DELETE FROM web_sessions WHERE session_id = ?', [sid]).then(() => undefined),
            cb
        );
    }

    async clearExpired() {
        await this.pool.query('DELETE FROM web_sessions WHERE expires < ?', [Math.floor(Date.now() / 1000)]);
    }

    close() {
        clearInterval(this.cleanupTimer);
    }
}
