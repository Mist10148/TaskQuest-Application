/**
 * Calendar feed: GET /api/calendar/<token>.ics (subscribe from Google Calendar,
 * Apple Calendar, Outlook...). Calendar apps cannot send cookies, so the secret
 * is the unguessable per-user token; it can be regenerated or revoked from the
 * settings page. Unknown and revoked tokens look identical (404).
 */

import { Router } from 'express';
import db from '@taskquest/shared/db';
import shared from '@taskquest/shared';
import { asyncRoute } from '../lib/http.js';

const router = Router();

router.get(
    '/:file',
    asyncRoute(async (req, res) => {
        const match = /^([a-f0-9]{32})\.ics$/.exec(req.params.file);
        const discordId = match ? await db.transfer.findUserByCalendarToken(match[1]) : null;
        if (!discordId) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });

        const { lists, items } = await db.transfer.getCalendarData(discordId);
        res.set({
            'Content-Type': 'text/calendar; charset=utf-8',
            'Cache-Control': 'private, max-age=300',
            'Content-Disposition': 'inline; filename="taskquest.ics"',
            'Referrer-Policy': 'no-referrer',
            'X-Robots-Tag': 'noindex'
        });
        res.send(shared.buildIcs({ lists, items }));
    })
);

export default router;
