/** Spreadsheet (CSV) import. Reward-free and all-or-nothing, like the JSON import. */

import { Router } from 'express';
import db from '@taskquest/shared/db';
import shared from '@taskquest/shared';
import { asyncRoute, parse, uid } from '../lib/http.js';
import { csvImportBody } from '../lib/schemas.js';
import aiClient from '../lib/aiClient.js';
import { heavyLimiter } from '../lib/security.js';

const { TaskQuestError } = shared;
const router = Router();

// Body {csv, dryRun?}. A dry run only reports what would be imported (and any row errors) and writes nothing.
router.post(
    '/csv',
    heavyLimiter,
    asyncRoute(async (req, res) => {
        const { csv, dryRun } = parse(csvImportBody, req.body);
        const parsed = shared.csvToImport(csv);
        const summary = { rows: parsed.rows, lists: parsed.lists, items: parsed.items, preview: parsed.preview, errors: parsed.errors, errorCount: parsed.errorCount };
        if (dryRun) {
            // The real import applies the shared limits (tasks per list, in total, lists) before writing, so the
            // preview must too, or it says OK for a file the import then refuses.
            let limitError = null;
            if (!parsed.errorCount) {
                try {
                    db.transfer.parseImport(parsed.data);
                } catch (err) {
                    if (!(err instanceof TaskQuestError)) throw err;
                    limitError = err.message;
                }
            }
            // Reported as a row-0 error so the same list in the web dialog shows it.
            if (limitError) return res.json({ ok: false, ...summary, errors: [{ row: 0, message: limitError }, ...parsed.errors], errorCount: parsed.errorCount + 1 });
            return res.json({ ok: parsed.errorCount === 0, ...summary });
        }
        if (parsed.errorCount) {
            const n = parsed.errorCount;
            throw new TaskQuestError('VALIDATION', `The CSV has ${n} problem${n === 1 ? '' : 's'}; nothing was imported.`, 400, { errors: parsed.errors, errorCount: n });
        }
        const result = await db.transfer.importAll(uid(req), parsed.data);
        aiClient.syncUser(uid(req));
        res.status(201).json({ success: true, rows: parsed.rows, ...result });
    })
);

export default router;
