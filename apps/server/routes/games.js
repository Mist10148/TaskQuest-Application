/**
 * Server-authoritative games. The client only sends player decisions
 * (bet, hit/stand/double, rock/paper/scissors, a letter, an arcade score);
 * outcomes and payouts are decided by @taskquest/shared.
 */

import { Router } from 'express';
import db from '@taskquest/shared/db';
import shared from '@taskquest/shared';
import { asyncRoute, parse, uid } from '../lib/http.js';
import {
    blackjackStartBody,
    blackjackActionBody,
    rpsBody,
    hangmanGuessBody,
    arcadeParam,
    arcadeFinishBody,
    quitParam
} from '../lib/schemas.js';

const router = Router();

router.get(
    '/config',
    (req, res) => {
        res.json({
            blackjack: shared.BLACKJACK_CONFIG,
            rewards: { rpsWin: shared.REWARDS.RPS_WIN, hangmanPerLife: shared.REWARDS.HANGMAN_PER_LIFE, hangmanMin: shared.REWARDS.HANGMAN_MIN },
            arcade: shared.ARCADE_CONFIG,
            limits: { freeGameXPPerDay: shared.LIMITS.FREE_GAME_XP_PER_DAY, cooldownMs: shared.LIMITS.GAME_COOLDOWN_MS }
        });
    }
);

router.get(
    '/history',
    asyncRoute(async (req, res) => {
        res.json(await db.games.getGameHistory(uid(req), 20));
    })
);

router.get(
    '/active',
    asyncRoute(async (req, res) => {
        const [blackjack, hangman] = await Promise.all([db.games.getActiveBlackjack(uid(req)), db.games.getActiveHangman(uid(req))]);
        res.json({ blackjack, hangman });
    })
);

router.post(
    '/blackjack/start',
    asyncRoute(async (req, res) => {
        const { bet } = parse(blackjackStartBody, req.body);
        res.json(await db.games.startBlackjack(uid(req), bet));
    })
);

router.post(
    '/blackjack/action',
    asyncRoute(async (req, res) => {
        const { action } = parse(blackjackActionBody, req.body);
        res.json(await db.games.blackjackAction(uid(req), action));
    })
);

router.post(
    '/rps',
    asyncRoute(async (req, res) => {
        const { choice } = parse(rpsBody, req.body);
        res.json(await db.games.playRps(uid(req), choice));
    })
);

router.post(
    '/hangman/start',
    asyncRoute(async (req, res) => {
        res.json(await db.games.startHangman(uid(req)));
    })
);

router.post(
    '/hangman/guess',
    asyncRoute(async (req, res) => {
        const { letter } = parse(hangmanGuessBody, req.body);
        res.json(await db.games.hangmanGuess(uid(req), letter));
    })
);

router.post(
    '/arcade/:type/start',
    asyncRoute(async (req, res) => {
        const { type } = parse(arcadeParam, req.params);
        res.json(await db.games.startArcade(uid(req), type));
    })
);

router.post(
    '/arcade/:type/finish',
    asyncRoute(async (req, res) => {
        parse(arcadeParam, req.params);
        const { sessionId, score } = parse(arcadeFinishBody, req.body);
        res.json(await db.games.finishArcade(uid(req), sessionId, score));
    })
);

router.post(
    '/:type/quit',
    asyncRoute(async (req, res) => {
        const { type } = parse(quitParam, req.params);
        res.json({ success: await db.games.quitGame(uid(req), type) });
    })
);

export default router;
