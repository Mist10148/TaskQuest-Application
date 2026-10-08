/**
 * Request schemas (zod). Field-level business rules (lengths, real dates,
 * priorities) are enforced again by the shared services, so the bot and the
 * API apply identical validation.
 */

import { z } from 'zod';
import shared from '@taskquest/shared';

const { TEXT_LIMITS, PRIORITIES, GAME_TYPES } = shared;

export const idParam = z.object({ id: z.coerce.number().int().positive() });
export const listIdParam = z.object({ listId: z.coerce.number().int().positive() });
export const keyParam = z.object({ key: z.string().regex(/^[A-Za-z]{1,20}$/) });
export const skillParam = z.object({ skillId: z.string().regex(/^[a-z_]{1,50}$/) });

const optionalText = (max) => z.string().max(max).nullable().optional();
const nullableEmpty = (schema) => z.preprocess((v) => (v === '' ? null : v), schema);

export const settingsBody = z
    .object({
        gamification_enabled: z.boolean().optional(),
        automation_enabled: z.boolean().optional(),
        auto_delete_old_lists: z.boolean().optional()
    })
    .strict()
    .refine((o) => Object.keys(o).length > 0, 'Nothing to update');

export const resetBody = z.object({ confirm: z.literal('RESET') }).strict();

const listFields = {
    name: z.string().min(1).max(TEXT_LIMITS.LIST_NAME),
    description: optionalText(TEXT_LIMITS.DESCRIPTION),
    category: optionalText(TEXT_LIMITS.CATEGORY),
    priority: nullableEmpty(z.enum(PRIORITIES).nullable().optional()),
    deadline: nullableEmpty(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable().optional())
};

export const createListBody = z.object(listFields).strict();
export const updateListBody = z
    .object(listFields)
    .partial()
    .strict()
    .refine((o) => Object.keys(o).length > 0, 'Nothing to update');

export const createItemBody = z
    .object({
        name: z.string().min(1).max(TEXT_LIMITS.ITEM_NAME),
        description: optionalText(TEXT_LIMITS.DESCRIPTION)
    })
    .strict();

export const updateItemBody = z
    .object({
        name: z.string().min(1).max(TEXT_LIMITS.ITEM_NAME),
        description: optionalText(TEXT_LIMITS.DESCRIPTION),
        position: z.number().int().min(0).max(100000)
    })
    .partial()
    .strict()
    .refine((o) => Object.keys(o).length > 0, 'Nothing to update');

export const toggleItemBody = z.object({ completed: z.boolean().optional() }).strict().optional();

export const blackjackStartBody = z.object({ bet: z.number().int().positive().max(1_000_000) }).strict();
export const blackjackActionBody = z.object({ action: z.enum(['hit', 'stand', 'double']) }).strict();
export const rpsBody = z.object({ choice: z.enum(['rock', 'paper', 'scissors']) }).strict();
export const hangmanGuessBody = z.object({ letter: z.string().regex(/^[A-Za-z]$/) }).strict();
export const arcadeParam = z.object({ type: z.enum(Object.keys(shared.ARCADE_CONFIG)) });
export const arcadeFinishBody = z
    .object({ sessionId: z.number().int().positive(), score: z.number().int().min(0).max(1_000_000) })
    .strict();
export const quitParam = z.object({ type: z.enum(GAME_TYPES) });

// ── AI ───────────────────────────────────────────────────────────────────────
export const uuidParam = z.object({ threadId: z.string().uuid() });
export const aiSummaryBody = z
    .object({
        mode: z.enum(['list', 'digest', 'recap']),
        listId: z.number().int().positive().optional(),
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
export const internalIndexBody = z.object({ discordId: internalBase.discordId, listId: z.number().int().positive().optional() }).strict();
