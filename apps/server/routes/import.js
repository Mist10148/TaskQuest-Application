/** Spreadsheet (CSV) import. Reward-free and all-or-nothing, like the JSON import. */

import { Router } from 'express';
import db from '@taskquest/shared/db';
import shared from '@taskquest/shared';
import { asyncRoute, parse, uid } from '../lib/http.js';
import { csvImportBody } from '../lib/schemas.js';
import aiClient from '../lib/aiClient.js';

const { TaskQuestError } = shared;
const router = Router();

// Body {csv, dryRun?}. A dry run only reports what would be imported (and any row errors) and writes nothing.
router.post(
    '/csv',
    asyncRoute(async (req, res) => {
        const { csv, dryRun } = parse(csvImportBody, req.body);
        const parsed = shared.csvToImport(csv);
        const summary = { rows: parsed.rows, lists: parsed.lists, items: parsed.items, preview: parsed.preview, errors: parsed.errors, errorCount: parsed.errorCount };
        if (dryRun) return res.json({ ok: parsed.errorCount === 0, ...summary });
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
