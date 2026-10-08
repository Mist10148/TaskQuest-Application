'use strict';

/**
 * Track when a list itself changes. The AI reconcile job compares this with
 * the list's embedding so list-only edits (name, deadline, priority...) are
 * re-indexed even if the fire-and-forget re-index call was missed.
 */

exports.description = 'lists.updated_at';

exports.up = async (h) => {
    await h.addColumnIfMissing(
        'lists',
        'updated_at',
        'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
    );
};
