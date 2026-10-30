/**
 * Request schemas (zod). Field-level business rules (lengths, real dates,
 * priorities) are enforced again by the shared services, so the bot and the
 * API apply identical validation.
 */

import { z } from 'zod';
import shared from '@taskquest/shared';

const { TEXT_LIMITS, TAG_LIMITS, IMPORT_LIMITS, PRIORITIES, GAME_TYPES } = shared;
/** Row ids are INTEGER columns: a larger id can never exist, and Postgres would answer with a 22003 error (a 500). */
const MAX_ID = shared.validation.MAX_ID;

export const idParam = z.object({ id: z.coerce.number().int().positive().max(MAX_ID) });
/** Comment ids are BIGSERIAL: they may pass 2^31 long before any INTEGER id does. */
export const bigIdParam = z.object({ id: z.coerce.number().int().positive().max(shared.validation.MAX_BIG_ID) });
export const listIdParam = z.object({ listId: z.coerce.number().int().positive().max(MAX_ID) });
export const keyParam = z.object({ key: z.string().regex(/^[A-Za-z]{1,20}$/) });
export const leaderboardQuery = z
    .object({
        by: z.enum(shared.LEADERBOARDS).default('lifetime'),
        class: z.string().toUpperCase().pipe(z.enum(shared.CLASS_KEYS)).optional()
    })
    .strip();
export const questParam = z.object({ key: z.string().regex(/^[A-Za-z0-9_]{1,40}$/) });
export const cosmeticParam = z.object({ id: z.string().regex(/^[a-z_]{1,40}$/) });
export const equipCosmeticBody = z.object({ kind: z.enum(shared.COSMETIC_KINDS), id: z.string().regex(/^[a-z_]{1,40}$/).nullable() }).strict();
export const previewQuery = z
    .object({
        level: z.coerce.number().int().min(1).max(200).optional(),
        mix: z.enum(shared.SIM_MIXES).optional()
    })
    .strict();
export const transferBody = z.object({ memberKey: z.string().regex(/^[a-f0-9]{12}$/) }).strict();
export const respecBody = z.object({ classKey: z.string().regex(/^[A-Za-z]{1,20}$/) }).strict();
export const skillParam = z.object({ skillId: z.string().regex(/^[a-z_]{1,50}$/) });

const optionalText = (max) => z.string().max(max).nullable().optional();
const nullableEmpty = (schema) => z.preprocess((v) => (v === '' ? null : v), schema);

export const settingsBody = z
    .object({
        gamification_enabled: z.boolean().optional(),
        automation_enabled: z.boolean().optional(),
        auto_delete_old_lists: z.boolean().optional(),
        ai_enabled: z.boolean().optional(),
        weekly_digest: z.boolean().optional(),
        web_push: z.boolean().optional(),
        accept_invites: z.boolean().optional(),
        timezone: z.string().min(1).max(64).nullable().optional(),
        reminder_hour: z.number().int().min(0).max(23).optional()
    })
    .strict()
    .refine((o) => Object.keys(o).length > 0, 'Nothing to update');

/**
 * A JSON import (the shape GET /api/user/export writes). Only the top level is checked here; parseImport in the shared service
 * validates every list and task, with error messages that say which one.
 */
export const jsonImportBody = z
    .object({
        app: z.string().max(40).optional(),
        version: z.number().int().positive().optional(),
        exportedAt: z.string().max(40).optional(),
        lists: z.array(z.record(z.unknown())).max(IMPORT_LIMITS.LISTS)
    })
    .strip(); // like parseImport, other top-level fields are ignored

/** A spreadsheet import: the CSV text itself (1 MB), optionally just checked without writing. */
export const csvImportBody = z.object({ csv: z.string().min(1).max(1_000_000), dryRun: z.boolean().optional() }).strict();

/** A PushSubscription as the browser serialises it. The service re-validates the endpoint (https, public host, 2048 chars) and the keys. */
export const subscribeBody = z
    .object({
        subscription: z
            .object({
                endpoint: z.string().min(1).max(2048),
                expirationTime: z.number().nullable().optional(),
                keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(200) }).strict()
            })
            .strict()
    })
    .strict();
export const unsubscribeBody = z.object({ endpoint: z.string().min(1).max(2048) }).strict();
/** The bot's request to push a reminder to one user. */
export const internalPushBody = z
    .object({
        discordId: z.string().regex(/^\d{5,32}$/),
        title: z.string().min(1).max(100),
        body: z.string().max(300).optional(),
        url: z.string().max(200).optional()
    })
    .strict();
export const resetBody = z.object({ confirm: z.literal('RESET') }).strict();
export const prestigeBody = z.object({ confirm: z.literal('PRESTIGE') }).strict();

const listFields = {
    name: z.string().min(1).max(TEXT_LIMITS.LIST_NAME),
    description: optionalText(TEXT_LIMITS.DESCRIPTION),
    category: optionalText(TEXT_LIMITS.CATEGORY),
    priority: nullableEmpty(z.enum(PRIORITIES).nullable().optional()),
    deadline: nullableEmpty(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable().optional())
};

/** GET /api/lists/search: the text to find and where to look (quests by default). */
export const searchQuery = z.object({ q: z.string().trim().min(1).max(100), scope: z.enum(['lists', 'tasks', 'all']).default('lists') }).strip();

/** GET /api/lists/:id: optionally one page of tasks in position order. `cursor` is the `nextCursor` of the page before. */
export const listItemsQuery = z
    .object({
        limit: z.coerce.number().int().min(1).max(1000).optional(),
        cursor: z
            .string()
            .regex(/^\d{1,10}\.\d{1,19}$/, 'cursor must be the nextCursor of the previous page')
            // Both parts are compared with INTEGER columns: a bigger number would be a Postgres range error (a 500), not a 400.
            .refine((c) => c.split('.').every((n) => Number(n) <= MAX_ID), 'cursor must be the nextCursor of the previous page')
            .optional()
    })
    .strip()
    .refine((q) => q.cursor === undefined || q.limit !== undefined, 'cursor needs limit');

export const createListBody = z.object(listFields).strict();
export const updateListBody = z
    .object(listFields)
    .partial()
    .strict()
    .refine((o) => Object.keys(o).length > 0, 'Nothing to update');

// The service's tag limits (TAG_LIMITS), with room for what it strips before measuring: a leading # on each tag, and the
// ", " between tags in the string form. The service checks the cleaned tags exactly.
const tagsField = z
    .union([
        z.string().max(TAG_LIMITS.MAX_TAGS * (TAG_LIMITS.MAX_LENGTH + 3)),
        z.array(z.string().max(TAG_LIMITS.MAX_LENGTH + 1)).max(TAG_LIMITS.MAX_TAGS)
    ])
    .nullable()
    .optional();
const itemExtras = {
    due_date: nullableEmpty(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable().optional()),
    priority: nullableEmpty(z.enum(PRIORITIES).nullable().optional()),
    tags: tagsField,
    recurrence: nullableEmpty(z.enum(['daily', 'weekly', 'monthly']).nullable().optional()),
    estimate_minutes: z.number().int().min(1).max(shared.LIMITS.ESTIMATE_MAX_MINUTES).nullable().optional(),
    parent_id: z.number().int().positive().max(MAX_ID).nullable().optional()
};

export const createItemBody = z
    .object({
        name: z.string().min(1).max(TEXT_LIMITS.ITEM_NAME),
        description: optionalText(TEXT_LIMITS.DESCRIPTION),
        ...itemExtras
    })
    .strict();

export const updateItemBody = z
    .object({
        name: z.string().min(1).max(TEXT_LIMITS.ITEM_NAME),
        description: optionalText(TEXT_LIMITS.DESCRIPTION),
        position: z.number().int().min(0).max(100000),
        // A member key from the quest's members list ('owner' for the owner), or null to unassign. The service resolves it.
        assignee: z.string().max(64).nullable(),
        ...itemExtras
    })
    .partial()
    .strict()
    .refine((o) => Object.keys(o).length > 0, 'Nothing to update');

export const reorderBody = z.object({ itemIds: z.array(z.number().int().positive().max(MAX_ID)).max(5000) }).strict();
/** POST /api/items/:id/comments. The service trims it, strips control characters and checks 1 to TEXT_LIMITS.COMMENT characters again. */
export const commentBody = z.object({ body: z.string().min(1).max(TEXT_LIMITS.COMMENT) }).strict();
/** POST /api/items/:id/move: the quest a top-level task (and its subtasks) moves to. */
export const moveItemBody = z.object({ listId: z.number().int().positive().max(MAX_ID) }).strict();

export const toggleItemBody = z.object({ completed: z.boolean().optional() }).strict().optional();

const templateItem = z
    .object({
        name: z.string().min(1).max(TEXT_LIMITS.ITEM_NAME),
        description: optionalText(TEXT_LIMITS.DESCRIPTION),
        priority: nullableEmpty(z.enum(PRIORITIES).nullable().optional()),
        tags: tagsField,
        recurrence: nullableEmpty(z.enum(['daily', 'weekly', 'monthly']).nullable().optional())
    })
    .strict();
export const createTemplateBody = z
    .object({
        name: z.string().min(1).max(TEXT_LIMITS.LIST_NAME),
        description: optionalText(TEXT_LIMITS.DESCRIPTION),
        items: z.array(templateItem).min(1).max(shared.LIMITS.MAX_TEMPLATE_ITEMS)
    })
    .strict();
export const applyTemplateBody = z
    .object({ listName: z.string().min(1).max(TEXT_LIMITS.LIST_NAME).optional(), listId: z.number().int().positive().max(MAX_ID).optional() })
    .strict();
// Sharing: people are found by their exact Discord username, never by display name or Discord ID, and a member is addressed by an opaque key.
// dryRun asks who the username resolves to (for the confirmation step) without inviting anyone.
export const inviteBody = z
    .object({ username: z.string().trim().min(1).max(100), role: z.enum(shared.LIST_ROLES).default('viewer'), dryRun: z.boolean().optional() })
    .strict();
export const memberRoleBody = z.object({ role: z.enum(shared.LIST_ROLES) }).strict();
export const memberKeyParam = z.object({ id: z.coerce.number().int().positive().max(MAX_ID), memberKey: z.string().regex(/^[a-f0-9]{12}$/) });

export const partyMemberKeyParam = z.object({ memberKey: z.string().regex(/^[a-f0-9]{12}$/) });
export const createPartyBody = z.object({ name: z.string().trim().min(1).max(TEXT_LIMITS.PARTY_NAME) }).strict();
export const partyInviteBody = z.object({ username: z.string().trim().min(1).max(100), dryRun: z.boolean().optional() }).strict();

export const saveTemplateBody = z.object({ name: z.string().min(1).max(TEXT_LIMITS.LIST_NAME).optional() }).strict();

export const blackjackStartBody = z.object({ bet: z.number().int().positive().max(1_000_000) }).strict();
export const blackjackActionBody = z.object({ action: z.enum(['hit', 'stand', 'double']) }).strict();
export const rpsBody = z.object({ choice: z.enum(['rock', 'paper', 'scissors']) }).strict();
export const hangmanGuessBody = z.object({ letter: z.string().regex(/^[A-Za-z]$/) }).strict();
export const arcadeParam = z.object({ type: z.enum(Object.keys(shared.ARCADE_CONFIG)) });
const arcadeLimits = Object.values(shared.games.arcade.TELEMETRY_LIMITS);
export const ARCADE_MAX_TICKS = Math.max(...arcadeLimits.map((l) => l.maxTicks));
export const ARCADE_MAX_INPUT_VALUES = Math.max(...arcadeLimits.map((l) => l.maxInputs)) * 2;
// ticks and inputs are optional here only so that an old client (score alone) gets the clear
// "please refresh the page" error from the service instead of a generic validation failure.
export const arcadeFinishBody = z
    .object({
        sessionId: z.number().int().positive().max(MAX_ID),
        score: z.number().int().min(0).max(1_000_000),
        ticks: z.number().int().min(1).max(ARCADE_MAX_TICKS).optional(),
        inputs: z.array(z.number().int().min(0).max(1_000_000)).max(ARCADE_MAX_INPUT_VALUES).optional()
    })
    .strict();
export const quitParam = z.object({ type: z.enum(GAME_TYPES) });

export const focusStartBody = z.object({ minutes: z.number().int().min(shared.LIMITS.FOCUS_MIN_MINUTES).max(shared.LIMITS.FOCUS_MAX_MINUTES) }).strict();
export const reflectionBody = z.object({ note: z.string().min(1).max(shared.LIMITS.REFLECTION_MAX_LENGTH) }).strict();
export const goalBody = z.object({ target: z.number().int().min(shared.LIMITS.WEEKLY_GOAL_MIN).max(shared.LIMITS.WEEKLY_GOAL_MAX) }).strict();
export const focusFinishBody = z.object({ sessionId: z.number().int().positive().max(MAX_ID) }).strict();

export const statsHistoryQuery = z.object({ days: z.coerce.number().int().refine((n) => [7, 30, 90].includes(n), 'days must be 7, 30 or 90').default(30) }).strip();

// ── AI ───────────────────────────────────────────────────────────────────────
export const uuidParam = z.object({ threadId: z.string().uuid() });
export const aiSummaryBody = z
    .object({
        mode: z.enum(['list', 'digest', 'recap']),
        listId: z.number().int().positive().max(MAX_ID).optional(),
        range: z.enum(['day', 'week']).optional()
    })
    .strict()
    .refine((o) => o.mode !== 'list' || o.listId !== undefined, 'listId is required for mode "list"');
export const aiPrioritizeBody = z.object({ limit: z.number().int().min(1).max(20).optional() }).strict();
export const aiChatBody = z
    .object({ threadId: z.string().uuid().optional(), message: z.string().trim().min(1).max(2000) })
    .strict();
export const aiResumeBody = z.object({ approved: z.boolean() }).strict();

// Internal (AI service -> web) write endpoints. discordId comes from the trusted caller.
const internalBase = { discordId: z.string().regex(/^\d{1,32}$/) };
export const internalCreateListBody = z
    .object({
        ...internalBase,
        ...listFields,
        items: z.array(z.string().min(1).max(TEXT_LIMITS.ITEM_NAME)).max(20).optional()
    })
    .strict();
export const internalAddItemBody = z.object({ ...internalBase, ...createItemBody.shape }).strict();
export const internalToggleBody = z.object({ ...internalBase, completed: z.boolean().optional() }).strict();
export const internalUpdateListBody = z
    .object({ ...internalBase, priority: listFields.priority, deadline: listFields.deadline })
    .strict();
// Change a task's own fields (name, description, due date, priority, tags, repeat, parent). Moving is not offered.
export const internalUpdateItemBody = z
    .object({ ...internalBase, ...createItemBody.partial().shape })
    .strict()
    .refine((o) => Object.keys(o).length > 1, 'Nothing to update');
// Break a task down into 2-8 subtasks (the AI tool's limits; the shared service allows up to 20).
export const internalSubtasksBody = z
    .object({ ...internalBase, names: z.array(z.string().min(1).max(TEXT_LIMITS.ITEM_NAME)).min(2).max(8) })
    .strict();
