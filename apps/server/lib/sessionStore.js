/**
 * express-session store backed by the `web_sessions` table (migration 001),
 * using the shared mysql2 pool. Replaces express-mysql-session, which pins an
 * old, vulnerable mysql2 release.
 */

import session from 'express-session';

export class MySQLSessionStore extends session.Store {
    /**
     * @param {import('mysql2/promise').Pool} pool
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
        this.pool
            .query('SELECT data FROM web_sessions WHERE session_id = ? AND expires >= ?', [sid, Math.floor(Date.now() / 1000)])
            .then(([rows]) => cb(null, rows[0] ? JSON.parse(rows[0].data) : null))
            .catch((err) => cb(err));
    }

    set(sid, sess, cb = () => {}) {
        this.pool
            .query(
                `INSERT INTO web_sessions (session_id, expires, data) VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE expires = VALUES(expires), data = VALUES(data)`,
                [sid, this.expiresAt(sess), JSON.stringify(sess)]
            )
            .then(() => cb(null))
            .catch((err) => cb(err));
    }

    touch(sid, sess, cb = () => {}) {
        this.pool
            .query('UPDATE web_sessions SET expires = ? WHERE session_id = ?', [this.expiresAt(sess), sid])
            .then(() => cb(null))
            .catch((err) => cb(err));
    }

    destroy(sid, cb = () => {}) {
        this.pool
            .query('DELETE FROM web_sessions WHERE session_id = ?', [sid])
            .then(() => cb(null))
            .catch((err) => cb(err));
    }

    async clearExpired() {
        await this.pool.query('DELETE FROM web_sessions WHERE expires < ?', [Math.floor(Date.now() / 1000)]);
    }

    close() {
        clearInterval(this.cleanupTimer);
    }
}
