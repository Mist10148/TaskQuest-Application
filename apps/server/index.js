/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🌐 TASKQUEST WEB SERVER - Express API with Discord OAuth
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import express from 'express';
import cors from 'cors';
import session from 'express-session';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import { CLASSES, SKILL_TREES, ACHIEVEMENTS, checkAchievements } from './gameData.js';
import { calculateFinalXP } from './gameLogic.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// ═══════════════════════════════════════════════════════════════════════════════
//  MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

// Trust proxy for Render/Railway/etc
app.set('trust proxy', 1);

app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true
}));

app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET || 'taskquest-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    }
}));

// Auth middleware
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
};

// Achievement checking helper - checks and unlocks any new achievements
async function checkAndUnlockAchievements(discordId) {
    try {
        const user = await db.getUser(discordId);
        if (!user) return [];
        
        const existingAchievements = await db.getAchievements(discordId);
        const unlockedKeys = existingAchievements.map(a => a.achievement_key);
        
        const newAchievements = checkAchievements(user, unlockedKeys);
        
        // Unlock any new achievements
        for (const ach of newAchievements) {
            await db.unlockAchievement(discordId, ach.key);
        }
        
        return newAchievements;
    } catch (error) {
        console.error('Achievement check error:', error);
        return [];
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/health', async (req, res) => {
    try {
        await db.getPool();
        res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
    } catch (error) {
        res.status(500).json({ status: 'error', database: 'disconnected', error: error.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  DISCORD OAUTH
// ═══════════════════════════════════════════════════════════════════════════════

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'http://localhost:3001/api/auth/callback';

// Redirect to Discord login
app.get('/api/auth/discord', (req, res) => {
    const params = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        redirect_uri: DISCORD_REDIRECT_URI,
        response_type: 'code',
        scope: 'identify'
    });
    res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

// Discord OAuth callback
app.get('/api/auth/callback', async (req, res) => {
    const { code } = req.query;
    
    if (!code) {
        return res.redirect('/?error=no_code');
    }
    
    try {
        // Exchange code for token
        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: DISCORD_REDIRECT_URI
            })
        });
        
        const tokens = await tokenResponse.json();
        
        if (!tokens.access_token) {
            console.error('Token error:', tokens);
            return res.redirect('/?error=token_failed');
        }
        
        // Get user info from Discord
        const userResponse = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokens.access_token}` }
        });
        
        const discordUser = await userResponse.json();
        
        // Create or get user in database, passing Discord profile info
        const dbUser = await db.getOrCreateUser(discordUser.id, {
            username: discordUser.username,
            avatar: discordUser.avatar
        });
        
        // Store in session
        req.session.user = {
            discordId: discordUser.id,
            username: discordUser.username,
            globalName: discordUser.global_name,
            avatar: discordUser.avatar,
            discriminator: discordUser.discriminator
        };
        
        // Redirect to dashboard
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        res.redirect(`${frontendUrl}/dashboard`);
        
    } catch (error) {
        console.error('OAuth error:', error);
        res.redirect('/?error=oauth_failed');
    }
});

// Get current user
app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
        const stats = await db.getUserStats(req.session.user.discordId);
        const skills = await db.getUserSkills(req.session.user.discordId);
        const achievements = await db.getAchievements(req.session.user.discordId);
        
        res.json({
            discord: req.session.user,
            ...stats,
            skills,
            userAchievements: achievements
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Failed to get user' });
    }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  USER ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Get user profile
app.get('/api/user', requireAuth, async (req, res) => {
    try {
        const stats = await db.getUserStats(req.session.user.discordId);
        const skills = await db.getUserSkills(req.session.user.discordId);
        res.json({ ...stats, skills });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get user' });
    }
});

// Update user settings
app.patch('/api/user', requireAuth, async (req, res) => {
    try {
        const { gamification_enabled, automation_enabled, auto_delete_old_lists } = req.body;
        const updates = {};

        if (gamification_enabled !== undefined) updates.gamification_enabled = gamification_enabled;
        if (automation_enabled !== undefined) updates.automation_enabled = automation_enabled;
        if (auto_delete_old_lists !== undefined) updates.auto_delete_old_lists = auto_delete_old_lists;

        const user = await db.updateUser(req.session.user.discordId, updates);
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// Claim daily reward
app.post('/api/user/daily', requireAuth, async (req, res) => {
    try {
        const result = await db.claimDaily(req.session.user.discordId);
        
        // Check for XP and level achievements
        const newAchievements = await checkAndUnlockAchievements(req.session.user.discordId);
        
        res.json({ ...result, newAchievements });
    } catch (error) {
        res.status(500).json({ error: 'Failed to claim daily' });
    }
});

// Reset all user progress (dangerous!)
app.post('/api/user/reset', requireAuth, async (req, res) => {
    try {
        const discordId = req.session.user.discordId;
        
        // Delete all user data
        await db.resetUserProgress(discordId);
        
        res.json({ success: true, message: 'All progress has been reset' });
    } catch (error) {
        console.error('Reset progress error:', error);
        res.status(500).json({ error: 'Failed to reset progress' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  LISTS ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Get all lists
app.get('/api/lists', requireAuth, async (req, res) => {
    try {
        const lists = await db.getLists(req.session.user.discordId);
        
        // Get item counts for each list
        const listsWithCounts = await Promise.all(lists.map(async (list) => {
            const items = await db.getItems(list.id);
            const completed = items.filter(i => i.completed).length;
            return {
                ...list,
                itemsTotal: items.length,
                itemsCompleted: completed
            };
        }));
        
        res.json(listsWithCounts);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get lists' });
    }
});

// Create list
app.post('/api/lists', requireAuth, async (req, res) => {
    try {
        const discordId = req.session.user.discordId;
        const { name, description, category, priority, deadline } = req.body;
        const list = await db.createList(
            discordId,
            name,
            description || null,
            category || null,
            priority || null,
            deadline || null
        );
        
        let xpResult = null;
        
        // Award XP for creating a list (with class and skill bonuses)
        const user = await db.getUser(discordId);
        if (user && user.gamification_enabled) {
            const userSkills = await db.getUserSkills(discordId);
            const baseXP = 10; // Base XP for creating a list
            
            const { finalXP, bonusInfo, userUpdates } = calculateFinalXP(user, userSkills, baseXP);
            
            xpResult = await db.addXPTransaction(discordId, finalXP, 'list_create');
            xpResult.finalXP = finalXP;
            xpResult.baseXP = baseXP;
            xpResult.bonusInfo = bonusInfo;
            
            if (Object.keys(userUpdates).length > 0) {
                await db.updateUser(discordId, userUpdates);
            }
        }
        
        // Check for new achievements
        const newAchievements = await checkAndUnlockAchievements(discordId);
        
        res.json({ ...list, newAchievements, xpResult });
    } catch (error) {
        console.error('Create list error:', error);
        res.status(500).json({ error: 'Failed to create list' });
    }
});

// Get single list with items
app.get('/api/lists/:id', requireAuth, async (req, res) => {
    try {
        const list = await db.getListById(req.params.id, req.session.user.discordId);
        if (!list) return res.status(404).json({ error: 'List not found' });
        
        const items = await db.getItems(list.id);
        res.json({ ...list, items });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get list' });
    }
});

// Update list
app.patch('/api/lists/:id', requireAuth, async (req, res) => {
    try {
        const { name, description, category, priority, deadline } = req.body;
        const updates = {};
        
        if (name !== undefined) updates.name = name;
        if (description !== undefined) updates.description = description;
        if (category !== undefined) updates.category = category;
        if (priority !== undefined) updates.priority = priority;
        if (deadline !== undefined) updates.deadline = deadline;
        
        const list = await db.updateList(req.params.id, req.session.user.discordId, updates);
        res.json(list);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update list' });
    }
});

// Delete list
app.delete('/api/lists/:id', requireAuth, async (req, res) => {
    try {
        await db.deleteList(req.params.id, req.session.user.discordId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete list' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  ITEMS ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Add item to list
app.post('/api/lists/:listId/items', requireAuth, async (req, res) => {
    try {
        const discordId = req.session.user.discordId;
        
        // Verify list belongs to user
        const list = await db.getListById(req.params.listId, discordId);
        if (!list) return res.status(404).json({ error: 'List not found' });
        
        const { name, description } = req.body;
        const item = await db.createItem(list.id, name, description || null);
        
        let xpResult = null;
        
        // Award XP for creating an item (with class and skill bonuses)
        const user = await db.getUser(discordId);
        if (user && user.gamification_enabled) {
            const userSkills = await db.getUserSkills(discordId);
            const baseXP = 5; // Base XP for creating an item
            
            const { finalXP, bonusInfo, userUpdates } = calculateFinalXP(user, userSkills, baseXP);
            
            xpResult = await db.addXPTransaction(discordId, finalXP, 'item_create');
            xpResult.finalXP = finalXP;
            xpResult.baseXP = baseXP;
            xpResult.bonusInfo = bonusInfo;
            
            if (Object.keys(userUpdates).length > 0) {
                await db.updateUser(discordId, userUpdates);
            }
        }
        
        // Check for new achievements
        const newAchievements = await checkAndUnlockAchievements(discordId);
        
        res.json({ ...item, newAchievements, xpResult });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create item' });
    }
});

// Update item
app.patch('/api/items/:id', requireAuth, async (req, res) => {
    try {
        const { name, description, position } = req.body;
        const updates = {};
        
        if (name !== undefined) updates.name = name;
        if (description !== undefined) updates.description = description;
        if (position !== undefined) updates.position = position;
        
        const item = await db.updateItem(req.params.id, updates);
        res.json(item);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update item' });
    }
});

// Toggle item complete
app.patch('/api/items/:id/toggle', requireAuth, async (req, res) => {
    try {
        const discordId = req.session.user.discordId;
        const item = await db.toggleItemComplete(req.params.id, discordId);
        
        let xpResult = null;
        
        // Award XP if completed (with class and skill bonuses)
        if (item && item.completed) {
            const user = await db.getUser(discordId);
            
            if (user && user.gamification_enabled) {
                const userSkills = await db.getUserSkills(discordId);
                const baseXP = 10; // Base XP for completing a task
                
                // Calculate final XP with class and skill bonuses
                const { finalXP, bonusInfo, userUpdates } = calculateFinalXP(user, userSkills, baseXP);
                
                // Add XP transaction
                xpResult = await db.addXPTransaction(discordId, finalXP, 'task_complete', item.id);
                xpResult.finalXP = finalXP;
                xpResult.baseXP = baseXP;
                xpResult.bonusInfo = bonusInfo;
                
                // Update class-specific counters (assassin_streak, wizard_counter, etc.)
                if (Object.keys(userUpdates).length > 0) {
                    await db.updateUser(discordId, userUpdates);
                }
            }
        }
        
        // Check for new achievements
        const newAchievements = await checkAndUnlockAchievements(discordId);
        
        res.json({ ...item, newAchievements, xpResult });
    } catch (error) {
        console.error('Toggle item error:', error);
        res.status(500).json({ error: 'Failed to toggle item' });
    }
});

// Delete item
app.delete('/api/items/:id', requireAuth, async (req, res) => {
    try {
        await db.deleteItem(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete item' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  CLASSES ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Get all classes with user ownership
app.get('/api/classes', requireAuth, async (req, res) => {
    try {
        const user = await db.getUser(req.session.user.discordId);
        
        const classesWithOwnership = Object.entries(CLASSES).map(([key, classData]) => ({
            key,
            ...classData,
            owned: key === 'DEFAULT' || user[`owns_${key.toLowerCase()}`] || false,
            equipped: user.player_class === key
        }));
        
        res.json({
            classes: classesWithOwnership,
            currentClass: user.player_class,
            playerXP: user.player_xp
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get classes' });
    }
});

// Purchase class
app.post('/api/classes/:key/buy', requireAuth, async (req, res) => {
    try {
        const classKey = req.params.key.toUpperCase();
        const classData = CLASSES[classKey];
        
        if (!classData) return res.status(404).json({ error: 'Class not found' });
        
        const user = await db.getUser(req.session.user.discordId);
        
        if (user[`owns_${classKey.toLowerCase()}`]) {
            return res.status(400).json({ error: 'Already owned' });
        }
        
        if (user.player_xp < classData.cost) {
            return res.status(400).json({ error: 'Not enough XP' });
        }
        
        // Deduct XP and grant ownership
        await db.updateUser(req.session.user.discordId, {
            player_xp: user.player_xp - classData.cost,
            [`owns_${classKey.toLowerCase()}`]: true,
            player_class: classKey
        });
        
        // Check for class achievements (BUY_CLASS, ALL_CLASSES)
        const newAchievements = await checkAndUnlockAchievements(req.session.user.discordId);
        
        const updatedUser = await db.getUser(req.session.user.discordId);
        res.json({ success: true, user: updatedUser, newAchievements });
    } catch (error) {
        res.status(500).json({ error: 'Failed to purchase class' });
    }
});

// Equip class
app.post('/api/classes/:key/equip', requireAuth, async (req, res) => {
    try {
        const classKey = req.params.key.toUpperCase();
        const user = await db.getUser(req.session.user.discordId);
        
        if (classKey !== 'DEFAULT' && !user[`owns_${classKey.toLowerCase()}`]) {
            return res.status(400).json({ error: 'Class not owned' });
        }
        
        await db.updateUser(req.session.user.discordId, {
            player_class: classKey,
            assassin_streak: 0,
            assassin_stacks: 0,
            wizard_counter: 0,
            archer_streak: 0,
            tank_stacks: 0
        });
        
        const updatedUser = await db.getUser(req.session.user.discordId);
        res.json({ success: true, user: updatedUser });
    } catch (error) {
        res.status(500).json({ error: 'Failed to equip class' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SKILLS ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Get skill trees
app.get('/api/skills', requireAuth, async (req, res) => {
    try {
        const user = await db.getUser(req.session.user.discordId);
        const userSkills = await db.getUserSkills(req.session.user.discordId);
        
        // Create skill map for easy lookup
        const skillMap = new Map(userSkills.map(s => [s.skill_id, s.skill_level]));
        
        // Add user's skill levels and class ownership to skill trees
        const treesWithProgress = Object.entries(SKILL_TREES).map(([classKey, tree]) => ({
            classKey,
            ...tree,
            // DEFAULT is always owned, other classes check owns_xxx field
            classOwned: classKey === 'DEFAULT' || user[`owns_${classKey.toLowerCase()}`] === 1,
            skills: Object.entries(tree.skills).map(([skillId, skill]) => ({
                id: skillId,
                ...skill,
                currentLevel: skillMap.get(skillId) || 0
            }))
        }));
        
        res.json({
            skillTrees: treesWithProgress,
            skillPoints: user.skill_points || 0,
            userXP: user.player_xp,
            playerClass: user.player_class
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get skills' });
    }
});

// Unlock/upgrade skill
app.post('/api/skills/:skillId/unlock', requireAuth, async (req, res) => {
    try {
        const { skillId } = req.params;
        const { classKey } = req.body;
        
        const user = await db.getUser(req.session.user.discordId);
        const tree = SKILL_TREES[classKey];
        
        if (!tree || !tree.skills[skillId]) {
            return res.status(404).json({ error: 'Skill not found' });
        }
        
        // CLASS-LOCKING: Only allow DEFAULT skills for everyone, or class-specific skills if owned
        if (classKey !== 'DEFAULT') {
            const ownsClass = user[`owns_${classKey.toLowerCase()}`];
            if (!ownsClass) {
                return res.status(403).json({ error: `You must own the ${classKey} class to unlock this skill` });
            }
        }
        
        const skill = tree.skills[skillId];
        const existingSkill = await db.hasSkill(req.session.user.discordId, skillId);
        const currentLevel = existingSkill?.skill_level || 0;
        
        // Check max level
        if (currentLevel >= skill.maxLevel) {
            return res.status(400).json({ error: 'Skill already maxed' });
        }
        
        // Check cost
        if (user.player_xp < skill.cost) {
            return res.status(400).json({ error: 'Not enough XP' });
        }
        
        // Check prerequisites
        if (skill.requires) {
            const hasReq = await db.hasSkill(req.session.user.discordId, skill.requires);
            if (!hasReq) {
                return res.status(400).json({ error: 'Prerequisite not met' });
            }
        }
        
        // Deduct XP
        await db.updateUser(req.session.user.discordId, {
            player_xp: user.player_xp - skill.cost
        });
        
        // Unlock or upgrade
        if (currentLevel === 0) {
            await db.unlockSkill(req.session.user.discordId, skillId);
        } else {
            await db.upgradeSkill(req.session.user.discordId, skillId);
        }
        
        const updatedSkill = await db.hasSkill(req.session.user.discordId, skillId);
        res.json({ success: true, skill: updatedSkill });
    } catch (error) {
        res.status(500).json({ error: 'Failed to unlock skill' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  ACHIEVEMENTS ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Get achievements
app.get('/api/achievements', requireAuth, async (req, res) => {
    try {
        const userAchievements = await db.getAchievements(req.session.user.discordId);
        const unlockedKeys = userAchievements.map(a => a.achievement_key);
        
        const achievementsWithStatus = Object.entries(ACHIEVEMENTS).map(([key, ach]) => ({
            key,
            ...ach,
            unlocked: unlockedKeys.includes(key),
            unlockedAt: userAchievements.find(a => a.achievement_key === key)?.unlocked_at || null
        }));
        
        res.json({
            achievements: achievementsWithStatus,
            unlockedCount: unlockedKeys.length,
            totalCount: Object.keys(ACHIEVEMENTS).length
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get achievements' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  LEADERBOARD ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/leaderboard', async (req, res) => {
    try {
        const users = await db.getLeaderboard(10);
        
        const leaderboard = await Promise.all(users.map(async (user, index) => {
            const stats = await db.getUserStats(user.discord_id);
            
            return {
                rank: index + 1,
                discordId: user.discord_id,
                username: user.discord_username || null,
                avatar: user.discord_avatar || null,
                xp: user.player_xp,
                level: user.player_level,
                playerClass: user.player_class,
                streak: user.streak_count,
                gamesPlayed: stats?.games?.played || 0,
                tasksCompleted: parseInt(stats?.items?.completed) || 0
            };
        }));
        
        res.json(leaderboard);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get leaderboard' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GAMES ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Get game history
app.get('/api/games/history', requireAuth, async (req, res) => {
    try {
        const history = await db.getGameHistory(req.session.user.discordId, 20);
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get game history' });
    }
});

// Record game result
app.post('/api/games/result', requireAuth, async (req, res) => {
    try {
        const { gameType, result, bet, payout } = req.body;
        const discordId = req.session.user.discordId;

        console.log(`Recording game: ${gameType}, result: ${result}, bet: ${bet}, payout: ${payout}`);

        // Process XP change based on game type
        let xpChange = 0;
        let bonusInfo = null;

        // Get user and skills for bonus calculation
        const user = await db.getUser(discordId);
        const userSkills = await db.getUserSkills(discordId);
        
        // Free arcade games (no bet, payout = base XP earned)
        if (['snake', 'dino', 'invaders'].includes(gameType)) {
            if (result === 'won' && payout >= 0) {  // Changed > to >= to handle 0-score games
                const baseXP = payout; // payout IS the XP for free games

                if (user && user.gamification_enabled && baseXP > 0) {
                    const { finalXP, bonusInfo: info, userUpdates } = calculateFinalXP(user, userSkills, baseXP);
                    xpChange = finalXP;
                    bonusInfo = info;
                    await db.addXPTransaction(discordId, xpChange, 'game_reward');
                    if (Object.keys(userUpdates).length > 0) {
                        await db.updateUser(discordId, userUpdates);
                    }
                } else {
                    xpChange = baseXP;
                    if (baseXP > 0) {
                        await db.addXPTransaction(discordId, xpChange, 'game_reward');
                    }
                }
            }
            // Record free game (bet=0, payout=xpChange for history display)
            await db.recordGameResult(discordId, gameType, result, 0, xpChange);
        } else if (gameType === 'rps') {
            // RPS is risk-free - only gain XP on win, never lose
            if (result === 'won') {
                const baseXP = bet; // Win pays 1x
                
                if (user && user.gamification_enabled) {
                    const { finalXP, bonusInfo: info, userUpdates } = calculateFinalXP(user, userSkills, baseXP);
                    xpChange = finalXP;
                    bonusInfo = info;
                    await db.addXPTransaction(discordId, xpChange, 'game_reward');
                    if (Object.keys(userUpdates).length > 0) {
                        await db.updateUser(discordId, userUpdates);
                    }
                } else {
                    xpChange = baseXP;
                    await db.addXPTransaction(discordId, xpChange, 'game_reward');
                }
            }
            // Record RPS game
            const displayPayout = result === 'won' ? bet + xpChange : (result === 'push' ? bet : 0);
            await db.recordGameResult(discordId, gameType, result, bet, displayPayout);
        } else if (gameType === 'hangman') {
            // Hangman: win = payout with bonuses, lose = -bet (no bonuses on loss)
            if (result === 'won') {
                const baseXP = payout - bet;
                
                if (user && user.gamification_enabled && baseXP > 0) {
                    const { finalXP, bonusInfo: info, userUpdates } = calculateFinalXP(user, userSkills, baseXP);
                    xpChange = finalXP;
                    bonusInfo = info;
                    await db.addXPTransaction(discordId, xpChange, 'game_reward');
                    if (Object.keys(userUpdates).length > 0) {
                        await db.updateUser(discordId, userUpdates);
                    }
                } else {
                    xpChange = baseXP;
                    if (baseXP !== 0) await db.addXPTransaction(discordId, xpChange, 'game_reward');
                }
            } else if (result === 'lost') {
                xpChange = -bet;
                await db.addXPTransaction(discordId, xpChange, 'game_reward');
            }
            // Record hangman game
            const displayPayout = result === 'won' ? bet + xpChange : 0;
            await db.recordGameResult(discordId, gameType, result, bet, displayPayout);
        } else {
            // Blackjack and other betting games
            if (result === 'won' || result === 'blackjack') {
                const baseXP = payout - bet;
                
                if (user && user.gamification_enabled && baseXP > 0) {
                    const { finalXP, bonusInfo: info, userUpdates } = calculateFinalXP(user, userSkills, baseXP);
                    xpChange = finalXP;
                    bonusInfo = info;
                    await db.addXPTransaction(discordId, xpChange, 'game_reward');
                    if (Object.keys(userUpdates).length > 0) {
                        await db.updateUser(discordId, userUpdates);
                    }
                } else {
                    xpChange = baseXP;
                    if (baseXP !== 0) await db.addXPTransaction(discordId, xpChange, 'game_reward');
                }
            } else if (result === 'lost') {
                xpChange = -bet;
                await db.addXPTransaction(discordId, xpChange, 'game_reward');
            }
            // Record betting game
            const displayPayout = result === 'push' ? bet : (xpChange >= 0 ? bet + xpChange : 0);
            await db.recordGameResult(discordId, gameType, result, bet, displayPayout);
        }
        
        // Check for XP/Level achievements
        const newAchievements = await checkAndUnlockAchievements(discordId);
        
        const updatedUser = await db.getUser(discordId);
        res.json({ 
            success: true, 
            xpChange,
            bonusInfo,
            newBalance: updatedUser.player_xp,
            newAchievements
        });
    } catch (error) {
        console.error('Record game error:', error);
        res.status(500).json({ error: 'Failed to record game' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  XP HISTORY
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/xp/history', requireAuth, async (req, res) => {
    try {
        const history = await db.getXPHistory(req.session.user.discordId, 50);
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get XP history' });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  STATIC DATA (Classes, Skills, Achievements)
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/data/classes', (req, res) => {
    res.json(CLASSES);
});

app.get('/api/data/skills', (req, res) => {
    res.json(SKILL_TREES);
});

app.get('/api/data/achievements', (req, res) => {
    res.json(ACHIEVEMENTS);
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SERVE FRONTEND (Production)
// ═══════════════════════════════════════════════════════════════════════════════

if (process.env.NODE_ENV === 'production') {
    // Serve static files from the dist folder
    app.use(express.static(path.join(__dirname, '../web/dist')));
    
    // Handle React routing - serve index.html for non-API routes
    app.get('*', (req, res) => {
        if (!req.path.startsWith('/api')) {
            res.sendFile(path.join(__dirname, '../web/dist/index.html'));
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  START SERVER
// ═══════════════════════════════════════════════════════════════════════════════

app.listen(PORT, async () => {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║      🌐 TASKQUEST WEB SERVER                                 ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║      Port: ${PORT}                                              ║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
    
    // Test database connection
    try {
        await db.getPool();
        console.log('✅ Database connected');
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
    }
});

export default app;