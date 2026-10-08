import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { useState, useEffect, useRef, useCallback } from "react";
import { Spade, Hand, Type, Sparkles, ArrowLeft, RotateCcw, Loader2, Gamepad2, Trophy, Zap, Minus, Plus, HelpCircle, Bug, Rocket, Skull, Target } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useGameHistory, invalidateProgress, showAchievementNotifications, showError } from "@/hooks/useApi";
import {
  gamesApi,
  type AchievementUnlock,
  type ArcadeType,
  type BlackjackResult,
  type Card,
  type GameSession,
  type HangmanActive,
  type HangmanResult,
  type RpsChoice,
  type RpsResult,
} from "@/lib/api";
import { toast } from "sonner";

/** Mirrors @taskquest/shared BLACKJACK_CONFIG; the server enforces it. */
const BLACKJACK_CONFIG = { MIN_BET: 10, MAX_BET_PERCENT: 0.25, HARD_CAP: 1000 };
const FREE_GAME_DAILY_CAP = 500;

function useNotifyAchievements() {
  const qc = useQueryClient();
  return useCallback((achievements: AchievementUnlock[] | undefined) => showAchievementNotifications(achievements, qc), [qc]);
}

type GameType = "menu" | "blackjack" | "rps" | "hangman" | "snake" | "dino" | "invaders";

// Neon Number Input Component
const NeonNumberInput = ({ value, onChange, min, max, step = 1 }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number }) => {
  const decrease = () => onChange(Math.max(min, value - step));
  const increase = () => onChange(Math.min(max, value + step));
  
  return (
    <div className="flex items-center gap-1 bg-background-secondary/50 rounded-lg border border-border p-1">
      <button 
        onClick={decrease} 
        disabled={value <= min}
        className="h-8 w-8 rounded-md flex items-center justify-center bg-background hover:bg-primary/20 hover:text-primary disabled:opacity-30 disabled:hover:bg-background transition-all border border-transparent hover:border-primary/50 hover:shadow-[0_0_10px_rgba(99,102,241,0.3)]"
      >
        <Minus className="h-4 w-4" />
      </button>
      <div className="relative">
        <input
          type="number"
          value={value}
          onChange={(e) => {
            const v = parseInt(e.target.value) || min;
            onChange(Math.min(max, Math.max(min, v)));
          }}
          min={min}
          max={max}
          className="w-16 h-8 bg-background border border-border rounded-md text-center font-heading font-bold text-lg focus:outline-none focus:border-primary focus:shadow-[0_0_15px_rgba(99,102,241,0.3)] transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <Sparkles className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-xp opacity-60" />
      </div>
      <button 
        onClick={increase}
        disabled={value >= max}
        className="h-8 w-8 rounded-md flex items-center justify-center bg-background hover:bg-primary/20 hover:text-primary disabled:opacity-30 disabled:hover:bg-background transition-all border border-transparent hover:border-primary/50 hover:shadow-[0_0_10px_rgba(99,102,241,0.3)]"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
};

const PlayingCard = ({ card }: { card: Card | null }) => {
  if (!card) return <div className="w-12 h-18 sm:w-16 sm:h-24 rounded-lg bg-gradient-to-br from-primary/30 to-primary/10 border-2 border-primary/50 flex items-center justify-center text-xl sm:text-2xl text-primary shadow-[0_0_20px_rgba(99,102,241,0.3)]">?</div>;
  return <motion.div initial={{ rotateY: 180, opacity: 0 }} animate={{ rotateY: 0, opacity: 1 }} className={cn("w-12 h-18 sm:w-16 sm:h-24 rounded-lg bg-foreground border-2 border-border flex flex-col items-center justify-center shadow-lg", ["♥","♦"].includes(card.suit) ? "text-destructive" : "text-background")}><span className="text-base sm:text-lg font-bold">{card.rank}</span><span className="text-lg sm:text-xl">{card.suit}</span></motion.div>;
};

// Game Instructions Component
const GameInstructions = ({ game }: { game: 'blackjack' | 'rps' | 'hangman' | 'snake' | 'dino' | 'invaders' }) => {
  const [expanded, setExpanded] = useState(false);
  
  const instructions: Record<string, string[]> = {
    blackjack: [
      "🎯 Goal: Get as close to 21 without going over",
      "🃏 Number cards = face value, Face cards = 10, Ace = 11 or 1",
      "👆 Hit = draw card, ✋ Stand = keep hand",
      "💰 Blackjack pays 1.5x, Win pays 1x, Push returns bet. Double down on your first two cards."
    ],
    rps: [
      "🪨 Rock beats ✂️ Scissors",
      "📄 Paper beats 🪨 Rock", 
      "✂️ Scissors beats 📄 Paper",
      "🛡️ 100% Risk-free! Win = +10 XP (plus class bonuses), lose = nothing"
    ],
    hangman: [
      "🔤 Guess the hidden word letter by letter",
      "❤️ You have 6 lives (wrong guesses)",
      "🎁 Win: +10 XP per remaining life (min 10)",
      "🆓 Free to play - losing costs nothing"
    ],
    snake: [
      "🐍 Swipe to move (or use arrow keys/WASD)",
      "🍎 Eat pellets to grow and earn XP",
      "💀 Don't hit walls or yourself!",
      "🎁 XP = Pellets eaten × 2 (max 100 per run)"
    ],
    dino: [
      "🦖 Tap screen or press SPACE to jump",
      "🌵 Avoid cacti and birds!",
      "🏆 Score +1 for each obstacle passed",
      "🎁 XP = Obstacles passed (max 100 per run)"
    ],
    invaders: [
      "🚀 Tap left/right to move & shoot",
      "👾 Destroy all aliens before they reach you!",
      "🏆 Desktop: Arrow keys/WASD + SPACE",
      "🎁 XP = Aliens destroyed × 3 (max 150 per run)"
    ]
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4">
      <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 text-xs text-foreground-muted hover:text-primary transition-colors mx-auto">
        <HelpCircle className="h-3.5 w-3.5" />
        {expanded ? 'Hide' : 'Show'} Rules
      </button>
      {expanded && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="mt-3 p-3 rounded-lg bg-background-secondary/50 border border-border/50">
          {instructions[game]?.map((line, i) => (
            <p key={i} className="text-xs text-foreground-muted py-0.5">{line}</p>
          ))}
        </motion.div>
      )}
    </motion.div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
//  BLACKJACK (server-dealt: the browser never sees the deck or hole card)
// ═══════════════════════════════════════════════════════════════════════════════

const BlackjackGame = ({ onBack, bet, onSettled }: { onBack: () => void; bet: number; onSettled: () => void }) => {
  const notifyAchievements = useNotifyAchievements();
  const [hand, setHand] = useState<BlackjackResult | null>(null);
  const [busy, setBusy] = useState(false);

  // Resume an unfinished hand (e.g. started from Discord or before a reload).
  useEffect(() => {
    gamesApi.getActive().then((a) => {
      if (a.blackjack) setHand({ ...a.blackjack, balance: 0, maxBet: 0, settlement: null });
    }).catch(() => {});
  }, []);

  const run = async (fn: () => Promise<BlackjackResult>) => {
    setBusy(true);
    try {
      const result = await fn();
      setHand(result);
      if (result.settlement) {
        const net = result.settlement.net;
        if (net > 0) toast.success(`🃏 ${result.view.outcome === 'blackjack' ? 'Blackjack!' : 'You win!'} +${net} XP`, { description: result.settlement.bonusInfo?.details || undefined });
        else if (net < 0) toast.error(`🃏 You lost ${-net} XP`);
        else toast.info('🤝 Push - bet returned');
        notifyAchievements(result.settlement.achievements);
        onSettled();
      }
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const deal = () => run(() => gamesApi.blackjackStart(bet));
  const act = (action: 'hit' | 'stand' | 'double') => run(() => gamesApi.blackjackAction(action));

  const view = hand?.view;
  const playing = Boolean(view && !view.finished);
  const ended = Boolean(view?.finished);
  const net = hand?.settlement?.net ?? 0;

  return (
    <div className="max-w-2xl mx-auto px-4">
      <div className="flex justify-between mb-6">
        <button onClick={onBack} className="flex items-center gap-2 text-foreground-muted hover:text-primary text-sm group transition-colors">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />Back
        </button>
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-violet-500/20 to-purple-500/5 border border-violet-500/30 shadow-[0_0_20px_rgba(139,92,246,0.2)]">
          <Sparkles className="h-4 w-4 text-violet-400" />
          <span className="font-heading font-bold text-lg text-violet-400">{view?.bet ?? bet} XP</span>
        </div>
      </div>
      <div className="rounded-2xl bg-card border border-border p-4 sm:p-8 relative overflow-hidden shadow-[0_0_30px_rgba(139,92,246,0.1)]">
        <div className="absolute inset-0 rounded-2xl border border-violet-500/20" style={{ boxShadow: 'inset 0 0 30px rgba(139,92,246,0.05)' }} />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-violet-500/50 to-transparent" />

        {!view ? (
          <div className="text-center py-8 relative z-10">
            <Spade className="h-16 w-16 mx-auto text-violet-400 mb-4 drop-shadow-[0_0_20px_rgba(139,92,246,0.5)]" />
            <h2 className="text-2xl font-heading font-bold mb-4 bg-gradient-to-r from-violet-400 to-purple-400 bg-clip-text text-transparent">Ready to Play?</h2>
            <Button onClick={deal} disabled={busy} className="gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 shadow-[0_0_20px_rgba(139,92,246,0.4)]">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gamepad2 className="h-4 w-4" />} Deal Cards ({bet} XP)
            </Button>
            <GameInstructions game="blackjack" />
          </div>
        ) : (
          <div className="relative z-10">
            <div className="text-center mb-6 pb-4 border-b border-border/50">
              <p className="text-xs text-foreground-muted mb-2">DEALER {playing && "(1 hidden)"}</p>
              <div className="flex justify-center gap-2 mb-2">{view.dealerHand.map((c, i) => <PlayingCard key={i} card={c} />)}</div>
              <p className="text-sm font-bold">{view.dealerValue.value}{playing ? '+?' : ''}</p>
            </div>
            <div className="text-center mb-6">
              <p className="text-xs text-foreground-muted mb-2">YOUR HAND</p>
              <div className="flex justify-center gap-2 mb-2">{view.playerHand.map((c, i) => <PlayingCard key={i} card={c} />)}</div>
              <p className="text-lg font-bold">{view.playerValue.value}{view.playerValue.soft ? ' (soft)' : ''}</p>
            </div>
            {playing ? (
              <div className="flex justify-center gap-3">
                <Button onClick={() => act('hit')} disabled={busy} variant="outline" className="border-violet-500/50 hover:bg-violet-500/10">👆 Hit</Button>
                <Button onClick={() => act('stand')} disabled={busy} className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500">✋ Stand</Button>
                {view.canDouble && <Button onClick={() => act('double')} disabled={busy} variant="outline" className="border-amber-500/50 text-amber-400 hover:bg-amber-500/10">💰 Double</Button>}
              </div>
            ) : ended ? (
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center">
                <p className={cn("text-2xl font-heading font-bold mb-2", view.outcome === "won" || view.outcome === "blackjack" ? "text-success" : view.outcome === "lost" ? "text-destructive" : "text-xp")}>
                  {view.outcome === "blackjack" ? "🎰 BLACKJACK!" : view.outcome === "won" ? "🎉 YOU WIN!" : view.outcome === "lost" ? (view.playerValue.bust ? "💔 BUST!" : "💔 DEALER WINS") : "🤝 PUSH"}
                </p>
                <p className={cn("text-lg font-bold mb-4", net >= 0 ? "text-success" : "text-destructive")}>{net >= 0 ? "+" : ""}{net} XP</p>
                <div className="flex justify-center gap-3">
                  <Button onClick={deal} disabled={busy} variant="outline" className="gap-2 border-violet-500/50 hover:bg-violet-500/10"><RotateCcw className="h-4 w-4" /> Play Again</Button>
                  <Button onClick={onBack} className="bg-gradient-to-r from-violet-600 to-purple-600">Back to Games</Button>
                </div>
              </motion.div>
            ) : null}
            <GameInstructions game="blackjack" />
          </div>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
//  RPS GAME (risk-free; the server picks the CPU move)
// ═══════════════════════════════════════════════════════════════════════════════

const RPS_EMOJI: Record<RpsChoice, string> = { rock: "🪨", paper: "📄", scissors: "✂️" };

const RPSGame = ({ onBack, onSettled }: { onBack: () => void; onSettled: () => void }) => {
  const notifyAchievements = useNotifyAchievements();
  const [round, setRound] = useState<RpsResult | null>(null);
  const [busy, setBusy] = useState(false);

  const play = async (choice: RpsChoice) => {
    setBusy(true);
    try {
      const r = await gamesApi.rps(choice);
      setRound(r);
      if (r.outcome === 'won') {
        if (r.xpGained > 0) toast.success(`🎮 Won +${r.xpGained} XP!`, { description: r.bonusInfo?.details || undefined });
        else toast.info('You won, but today\'s free-game XP cap is reached.');
      }
      notifyAchievements(r.achievements);
      onSettled();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4">
      <div className="flex justify-between mb-6">
        <button onClick={onBack} className="flex items-center gap-2 text-foreground-muted hover:text-primary text-sm group transition-colors">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />Back
        </button>
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500/20 to-emerald-500/5 border border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.2)]">
          <Sparkles className="h-4 w-4 text-emerald-400" />
          <span className="font-heading font-bold text-emerald-400">+10 XP per win • Risk-free!</span>
        </div>
      </div>
      <div className="rounded-2xl bg-card border border-border p-4 sm:p-8 relative overflow-hidden shadow-[0_0_30px_rgba(16,185,129,0.1)]">
        <div className="absolute inset-0 rounded-2xl border border-emerald-500/20" style={{ boxShadow: 'inset 0 0 30px rgba(16,185,129,0.05)' }} />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent" />

        {!round ? (
          <div className="text-center py-4 relative z-10">
            <h2 className="text-xl font-heading font-bold mb-6 bg-gradient-to-r from-emerald-400 to-green-400 bg-clip-text text-transparent">Choose Your Weapon!</h2>
            <div className="flex justify-center gap-4 mb-6">
              {(Object.keys(RPS_EMOJI) as RpsChoice[]).map((c) => (
                <motion.button key={c} disabled={busy} whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }} onClick={() => play(c)} aria-label={c} className="text-5xl p-4 rounded-2xl bg-background-secondary/50 hover:bg-emerald-500/20 border border-border hover:border-emerald-500/50 transition-all hover:shadow-[0_0_25px_rgba(16,185,129,0.3)] disabled:opacity-50">{RPS_EMOJI[c]}</motion.button>
              ))}
            </div>
            <GameInstructions game="rps" />
          </div>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-4 relative z-10">
            <div className="flex justify-center items-center gap-8 mb-6">
              <div className="text-center"><p className="text-xs text-foreground-muted mb-2">YOU</p><span className="text-5xl">{RPS_EMOJI[round.player]}</span></div>
              <span className="text-2xl font-bold text-foreground-muted">VS</span>
              <div className="text-center"><p className="text-xs text-foreground-muted mb-2">CPU</p><span className="text-5xl">{RPS_EMOJI[round.opponent]}</span></div>
            </div>
            <p className={cn("text-2xl font-heading font-bold mb-2", round.outcome === "won" ? "text-success" : round.outcome === "lost" ? "text-foreground-muted" : "text-xp")}>
              {round.outcome === "won" ? "🎉 YOU WIN!" : round.outcome === "lost" ? "😅 You Lose (No XP lost!)" : "🤝 TIE!"}
            </p>
            {round.outcome === "won" && <p className="text-lg font-bold text-success mb-4">+{round.xpGained} XP</p>}
            <div className="flex justify-center gap-3">
              <Button onClick={() => setRound(null)} variant="outline" className="gap-2 border-emerald-500/50 hover:bg-emerald-500/10"><RotateCcw className="h-4 w-4" /> Play Again</Button>
              <Button onClick={onBack} className="bg-gradient-to-r from-emerald-600 to-green-600">Back to Games</Button>
            </div>
            <GameInstructions game="rps" />
          </motion.div>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
//  HANGMAN GAME
// ═══════════════════════════════════════════════════════════════════════════════

// Hangman Figure Component
const HangmanFigure = ({ wrongGuesses }: { wrongGuesses: number }) => {
  return (
    <svg width="200" height="220" viewBox="0 0 200 220" className="mx-auto mb-4">
      {/* Gallows - always visible */}
      <g stroke="#64748b" strokeWidth="4" fill="none" strokeLinecap="round">
        {/* Base */}
        <line x1="20" y1="210" x2="100" y2="210" />
        {/* Pole */}
        <line x1="60" y1="210" x2="60" y2="20" />
        {/* Top */}
        <line x1="60" y1="20" x2="140" y2="20" />
        {/* Rope */}
        <line x1="140" y1="20" x2="140" y2="50" />
      </g>
      
      {/* Body parts - shown based on wrong guesses */}
      <g stroke="#ef4444" strokeWidth="3" fill="none" strokeLinecap="round">
        {/* Head - 1 wrong */}
        {wrongGuesses >= 1 && (
          <circle cx="140" cy="70" r="20" className="animate-pulse" style={{ filter: 'drop-shadow(0 0 8px rgba(239, 68, 68, 0.5))' }} />
        )}
        
        {/* Body - 2 wrong */}
        {wrongGuesses >= 2 && (
          <line x1="140" y1="90" x2="140" y2="150" style={{ filter: 'drop-shadow(0 0 8px rgba(239, 68, 68, 0.5))' }} />
        )}
        
        {/* Left Arm - 3 wrong */}
        {wrongGuesses >= 3 && (
          <line x1="140" y1="110" x2="110" y2="130" style={{ filter: 'drop-shadow(0 0 8px rgba(239, 68, 68, 0.5))' }} />
        )}
        
        {/* Right Arm - 4 wrong */}
        {wrongGuesses >= 4 && (
          <line x1="140" y1="110" x2="170" y2="130" style={{ filter: 'drop-shadow(0 0 8px rgba(239, 68, 68, 0.5))' }} />
        )}
        
        {/* Left Leg - 5 wrong */}
        {wrongGuesses >= 5 && (
          <line x1="140" y1="150" x2="110" y2="190" style={{ filter: 'drop-shadow(0 0 8px rgba(239, 68, 68, 0.5))' }} />
        )}
        
        {/* Right Leg - 6 wrong (dead) */}
        {wrongGuesses >= 6 && (
          <>
            <line x1="140" y1="150" x2="170" y2="190" style={{ filter: 'drop-shadow(0 0 8px rgba(239, 68, 68, 0.5))' }} />
            {/* X eyes when dead */}
            <line x1="132" y1="63" x2="138" y2="73" stroke="#ef4444" strokeWidth="2" />
            <line x1="138" y1="63" x2="132" y2="73" stroke="#ef4444" strokeWidth="2" />
            <line x1="142" y1="63" x2="148" y2="73" stroke="#ef4444" strokeWidth="2" />
            <line x1="148" y1="63" x2="142" y2="73" stroke="#ef4444" strokeWidth="2" />
          </>
        )}
        
        {/* Face when alive */}
        {wrongGuesses >= 1 && wrongGuesses < 6 && (
          <>
            {/* Eyes */}
            <circle cx="133" cy="68" r="2" fill="#ef4444" />
            <circle cx="147" cy="68" r="2" fill="#ef4444" />
            {/* Mouth - gets sadder */}
            {wrongGuesses < 4 ? (
              <path d="M 133 78 Q 140 82 147 78" fill="none" />
            ) : (
              <path d="M 133 82 Q 140 76 147 82" fill="none" />
            )}
          </>
        )}
      </g>
    </svg>
  );
};

const HangmanGame = ({ onBack, onSettled }: { onBack: () => void; onSettled: () => void }) => {
  const notifyAchievements = useNotifyAchievements();
  const [game, setGame] = useState<HangmanResult | HangmanActive | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const start = useCallback(async () => {
    setBusy(true);
    try {
      setGame(await gamesApi.hangmanStart());
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Resume an unfinished word, otherwise start a new one.
    gamesApi.getActive().then((a) => (a.hangman ? setGame(a.hangman) : start())).catch(start);
  }, [start]);

  const guess = async (letter: string) => {
    if (!game || game.view.finished || busy || game.view.guessed.includes(letter)) return;
    setBusy(true);
    try {
      const r = await gamesApi.hangmanGuess(letter);
      setGame(r);
      if (r.view.finished) {
        if (r.view.outcome === 'won') {
          if (r.xpGained > 0) toast.success(`📝 Won +${r.xpGained} XP!`, { description: r.bonusInfo?.details || undefined });
          else toast.info('You won, but today\'s free-game XP cap is reached.');
        }
        notifyAchievements(r.achievements);
        onSettled();
      }
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const leave = () => {
    if (game && !game.view.finished) gamesApi.quit('hangman').catch(() => {});
    onBack();
  };

  const view = game?.view;
  const lives = view?.lives ?? 6;
  const maxLives = view?.maxLives ?? 6;
  const xpGained = game && 'xpGained' in game ? game.xpGained : 0;

  return (
    <div className="max-w-2xl mx-auto px-4">
      <div className="flex justify-between mb-6">
        <button onClick={leave} className="flex items-center gap-2 text-foreground-muted hover:text-primary text-sm group transition-colors">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />Back
        </button>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500/20 to-cyan-500/5 border border-cyan-500/30">
            <Sparkles className="h-4 w-4 text-cyan-400" />
            <span className="font-heading font-bold text-cyan-400">Free play</span>
          </div>
          <div className="flex gap-1 px-3 py-2 rounded-lg bg-background-secondary/50 border border-border">
            {Array(maxLives).fill(0).map((_, i) => (
              <span key={i} className={cn("text-lg transition-all", i < lives ? "text-destructive" : "text-foreground-muted/30 scale-75")}>❤️</span>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-card border border-border p-4 sm:p-8 relative overflow-hidden shadow-[0_0_30px_rgba(6,182,212,0.1)]">
        <div className="absolute inset-0 rounded-2xl border border-cyan-500/20" style={{ boxShadow: 'inset 0 0 30px rgba(6,182,212,0.05)' }} />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />

        {!view ? (
          <div className="py-12 text-center relative z-10"><Loader2 className="h-6 w-6 animate-spin mx-auto text-cyan-400" /></div>
        ) : (
          <div className="relative z-10">
            <HangmanFigure wrongGuesses={maxLives - lives} />

            <div className="text-center mb-6">
              <div className="flex justify-center gap-2 text-3xl font-mono">
                {(view.finished && view.word ? view.word.split("") : view.masked).map((c, i) => (
                  <motion.span
                    key={i}
                    initial={c ? { scale: 1.2 } : {}}
                    animate={{ scale: 1 }}
                    className={cn("w-8 h-12 flex items-center justify-center font-bold relative", view.masked[i] ? "text-cyan-400" : view.finished ? "text-destructive" : "")}
                    style={{ borderBottom: view.masked[i] ? '3px solid rgb(6, 182, 212)' : '3px dashed rgb(148, 163, 184)' }}
                  >
                    {c ?? ""}
                  </motion.span>
                ))}
              </div>
              {!view.finished && (
                <p className="text-xs text-foreground-muted mt-2">
                  {lives} {lives === 1 ? 'life' : 'lives'} remaining • {view.potentialReward} XP if you win
                </p>
              )}
            </div>

            {!view.finished ? (
              <div className="flex flex-wrap justify-center gap-2">
                {"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(l => {
                  const used = view.guessed.includes(l);
                  const wrong = view.wrong.includes(l);
                  return (
                    <motion.button
                      key={l}
                      onClick={() => guess(l)}
                      disabled={used || busy}
                      whileHover={{ scale: used ? 1 : 1.1 }}
                      whileTap={{ scale: 0.95 }}
                      className={cn(
                        "w-9 h-9 rounded-lg font-bold text-sm transition-all",
                        used
                          ? !wrong
                            ? "bg-success/20 text-success border border-success/50"
                            : "bg-destructive/20 text-destructive border border-destructive/50 opacity-50"
                          : "bg-background-secondary hover:bg-cyan-500/20 hover:text-cyan-400 border border-border hover:border-cyan-500/50 hover:shadow-[0_0_15px_rgba(6,182,212,0.3)]"
                      )}
                    >
                      {l}
                    </motion.button>
                  );
                })}
              </div>
            ) : (
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center">
                {view.outcome === 'won' ? (
                  <>
                    <p className="text-2xl font-heading font-bold text-success mb-2">🎉 YOU WIN!</p>
                    <p className="text-foreground-muted mb-1">You guessed: <span className="font-bold text-cyan-400">{view.word}</span></p>
                    <p className="text-lg font-bold text-success mb-4">+{xpGained} XP</p>
                  </>
                ) : (
                  <>
                    <p className="text-2xl font-heading font-bold text-destructive mb-2">💀 GAME OVER</p>
                    <p className="text-foreground-muted mb-4">The word was: <span className="font-bold text-foreground">{view.word}</span></p>
                  </>
                )}
                <div className="flex justify-center gap-3">
                  <Button onClick={start} disabled={busy} variant="outline" className="gap-2 border-cyan-500/50 hover:bg-cyan-500/10"><RotateCcw className="h-4 w-4" /> New Word</Button>
                  <Button onClick={onBack} className="bg-gradient-to-r from-cyan-600 to-blue-600">Back to Games</Button>
                </div>
              </motion.div>
            )}
          </div>
        )}

        <GameInstructions game="hangman" />
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
//  🐍 SNAKE GAME (Web Exclusive)
// ═══════════════════════════════════════════════════════════════════════════════

const SnakeGame = ({ onBack, onStart, onResult }: { onBack: () => void; onStart: () => void; onResult: (r: string, points: number) => void }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<"ready"|"playing"|"ended">("ready");
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  
  const gameRef = useRef({
    snake: [{ x: 10, y: 10 }],
    dir: { x: 1, y: 0 },
    food: { x: 15, y: 15 },
    score: 0,
    gameOver: false,
    lastDir: { x: 1, y: 0 }
  });

  const GRID_SIZE = 20;
  const CELL_SIZE = 15;

  const startGame = () => {
    gameRef.current = {
      snake: [{ x: 10, y: 10 }],
      dir: { x: 1, y: 0 },
      food: { x: Math.floor(Math.random() * GRID_SIZE), y: Math.floor(Math.random() * GRID_SIZE) },
      score: 0,
      gameOver: false,
      lastDir: { x: 1, y: 0 }
    };
    setScore(0);
    setGameState("playing");
    onStart();
  };

  const endGame = useCallback((finalScore: number) => {
    setGameState("ended");
    setScore(finalScore);
    if (finalScore > highScore) setHighScore(finalScore);
    // Report pellets eaten; the server converts points to XP and caps it.
    onResult("won", finalScore);
  }, [highScore, onResult]);

  useEffect(() => {
    if (gameState !== "playing") return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const g = gameRef.current;
      if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") { if (g.lastDir.y !== 1) g.dir = { x: 0, y: -1 }; }
      else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") { if (g.lastDir.y !== -1) g.dir = { x: 0, y: 1 }; }
      else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") { if (g.lastDir.x !== 1) g.dir = { x: -1, y: 0 }; }
      else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") { if (g.lastDir.x !== -1) g.dir = { x: 1, y: 0 }; }
    };

    // Mobile touch controls (swipe)
    let touchStartX = 0;
    let touchStartY = 0;
    const handleTouchStart = (e: TouchEvent) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    };
    const handleTouchEnd = (e: TouchEvent) => {
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const diffX = touchEndX - touchStartX;
      const diffY = touchEndY - touchStartY;
      const g = gameRef.current;

      if (Math.abs(diffX) > Math.abs(diffY)) {
        // Horizontal swipe
        if (diffX > 30 && g.lastDir.x !== -1) g.dir = { x: 1, y: 0 }; // Right
        else if (diffX < -30 && g.lastDir.x !== 1) g.dir = { x: -1, y: 0 }; // Left
      } else {
        // Vertical swipe
        if (diffY > 30 && g.lastDir.y !== -1) g.dir = { x: 0, y: 1 }; // Down
        else if (diffY < -30 && g.lastDir.y !== 1) g.dir = { x: 0, y: -1 }; // Up
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    canvas.addEventListener("touchstart", handleTouchStart);
    canvas.addEventListener("touchend", handleTouchEnd);

    const gameLoop = setInterval(() => {
      const g = gameRef.current;
      if (g.gameOver) return;

      // Move snake
      const head = { x: g.snake[0].x + g.dir.x, y: g.snake[0].y + g.dir.y };
      g.lastDir = { ...g.dir };

      // Check collisions
      if (head.x < 0 || head.x >= GRID_SIZE || head.y < 0 || head.y >= GRID_SIZE || 
          g.snake.some(s => s.x === head.x && s.y === head.y)) {
        g.gameOver = true;
        endGame(g.score);
        return;
      }

      g.snake.unshift(head);

      // Check food
      if (head.x === g.food.x && head.y === g.food.y) {
        g.score++;
        setScore(g.score);
        g.food = { x: Math.floor(Math.random() * GRID_SIZE), y: Math.floor(Math.random() * GRID_SIZE) };
      } else {
        g.snake.pop();
      }

      // Draw
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Grid lines
      ctx.strokeStyle = "#1e293b";
      for (let i = 0; i <= GRID_SIZE; i++) {
        ctx.beginPath();
        ctx.moveTo(i * CELL_SIZE, 0);
        ctx.lineTo(i * CELL_SIZE, GRID_SIZE * CELL_SIZE);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * CELL_SIZE);
        ctx.lineTo(GRID_SIZE * CELL_SIZE, i * CELL_SIZE);
        ctx.stroke();
      }

      // Draw food with glow
      ctx.shadowColor = "#22c55e";
      ctx.shadowBlur = 10;
      ctx.fillStyle = "#22c55e";
      ctx.beginPath();
      ctx.arc(g.food.x * CELL_SIZE + CELL_SIZE/2, g.food.y * CELL_SIZE + CELL_SIZE/2, CELL_SIZE/2 - 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Draw snake with gradient
      g.snake.forEach((seg, i) => {
        const gradient = ctx.createRadialGradient(
          seg.x * CELL_SIZE + CELL_SIZE/2, seg.y * CELL_SIZE + CELL_SIZE/2, 0,
          seg.x * CELL_SIZE + CELL_SIZE/2, seg.y * CELL_SIZE + CELL_SIZE/2, CELL_SIZE/2
        );
        if (i === 0) {
          gradient.addColorStop(0, "#6366f1");
          gradient.addColorStop(1, "#4f46e5");
          ctx.shadowColor = "#6366f1";
          ctx.shadowBlur = 8;
        } else {
          gradient.addColorStop(0, "#818cf8");
          gradient.addColorStop(1, "#6366f1");
          ctx.shadowBlur = 0;
        }
        ctx.fillStyle = gradient;
        ctx.fillRect(seg.x * CELL_SIZE + 1, seg.y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
      });
      ctx.shadowBlur = 0;
    }, 100);

    return () => {
      clearInterval(gameLoop);
      window.removeEventListener("keydown", handleKeyDown);
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchend", handleTouchEnd);
    };
  }, [gameState, endGame]);

  return (
    <div className="max-w-2xl mx-auto px-4">
      <div className="flex justify-between mb-6">
        <button onClick={onBack} className="flex items-center gap-2 text-foreground-muted hover:text-primary text-sm group transition-colors">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />Back
        </button>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-green-500/20 to-green-500/5 border border-green-500/30">
            <Bug className="h-4 w-4 text-green-400" />
            <span className="font-heading font-bold text-green-400">Pellets: {score}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background-secondary/50 border border-border">
            <Trophy className="h-4 w-4 text-xp" />
            <span className="font-bold text-xp">Best: {highScore}</span>
          </div>
        </div>
      </div>
      
      <div className="rounded-2xl bg-card border border-border p-4 sm:p-8 relative overflow-hidden shadow-[0_0_30px_rgba(34,197,94,0.1)]">
        <div className="absolute inset-0 rounded-2xl border border-green-500/20" />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-green-500/50 to-transparent" />
        
        <div className="flex flex-col items-center relative z-10">
          {gameState === "ready" && (
            <div className="text-center py-8">
              <Bug className="h-16 w-16 mx-auto text-green-400 mb-4 drop-shadow-[0_0_20px_rgba(34,197,94,0.5)]" />
              <h2 className="text-2xl font-heading font-bold mb-2 bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">Snake</h2>
              <p className="text-foreground-muted mb-4">Eat pellets, grow longer, don't crash!</p>
              <p className="text-sm text-xp mb-4">🎁 XP = Pellets × 2</p>
              <Button onClick={startGame} className="gap-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500">
                <Gamepad2 className="h-4 w-4" /> Start Game
              </Button>
              <GameInstructions game="snake" />
            </div>
          )}
          
          {gameState === "playing" && (
            <canvas 
              ref={canvasRef} 
              width={GRID_SIZE * CELL_SIZE} 
              height={GRID_SIZE * CELL_SIZE}
              className="rounded-lg border border-green-500/30 shadow-[0_0_30px_rgba(34,197,94,0.2)]"
            />
          )}
          
          {gameState === "ended" && (
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center py-8">
              <p className="text-2xl font-heading font-bold text-destructive mb-2">💀 Game Over!</p>
              <p className="text-foreground-muted mb-2">Pellets eaten: {score}</p>
              <p className="text-lg font-bold text-success mb-4">+{score * 2} XP</p>
              <div className="flex justify-center gap-3">
                <Button onClick={startGame} variant="outline" className="gap-2 border-green-500/50 hover:bg-green-500/10">
                  <RotateCcw className="h-4 w-4" /> Play Again
                </Button>
                <Button onClick={onBack} className="bg-gradient-to-r from-green-600 to-emerald-600">Back to Games</Button>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
//  🦖 DINO RUNNER (Web Exclusive) - Improved Design
// ═══════════════════════════════════════════════════════════════════════════════

const DinoGame = ({ onBack, onStart, onResult }: { onBack: () => void; onStart: () => void; onResult: (r: string, points: number) => void }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<"ready"|"playing"|"ended">("ready");
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  
  const gameRef = useRef({
    dino: { y: 150, vy: 0, jumping: false, frame: 0 },
    obstacles: [] as { x: number; type: 'cactus' | 'bird'; passed: boolean; height: number }[],
    score: 0,
    speed: 6,
    gameOver: false,
    frameCount: 0,
    groundOffset: 0
  });

  const GROUND_Y = 160;
  const GRAVITY = 0.9;
  const JUMP_FORCE = -16;
  const CANVAS_WIDTH = 600;
  const CANVAS_HEIGHT = 200;

  const startGame = () => {
    gameRef.current = {
      dino: { y: GROUND_Y, vy: 0, jumping: false, frame: 0 },
      obstacles: [],
      score: 0,
      speed: 6,
      gameOver: false,
      frameCount: 0,
      groundOffset: 0
    };
    setScore(0);
    setGameState("playing");
    onStart();
  };

  const endGame = useCallback((finalScore: number) => {
    setGameState("ended");
    setScore(finalScore);
    if (finalScore > highScore) setHighScore(finalScore);
    onResult("won", finalScore);
  }, [highScore, onResult]);

  const jump = useCallback(() => {
    const g = gameRef.current;
    if (!g.dino.jumping && gameState === "playing") {
      g.dino.vy = JUMP_FORCE;
      g.dino.jumping = true;
    }
  }, [gameState]);

  // Draw dinosaur shape
  const drawDino = (ctx: CanvasRenderingContext2D, x: number, y: number, frame: number) => {
    ctx.save();
    ctx.shadowColor = "#f59e0b";
    ctx.shadowBlur = 15;
    ctx.fillStyle = "#f59e0b";
    
    // Body
    ctx.beginPath();
    ctx.ellipse(x + 20, y - 20, 18, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Head
    ctx.beginPath();
    ctx.ellipse(x + 38, y - 35, 12, 10, 0.3, 0, Math.PI * 2);
    ctx.fill();
    
    // Snout
    ctx.beginPath();
    ctx.ellipse(x + 48, y - 33, 6, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Eye
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#0f172a";
    ctx.beginPath();
    ctx.arc(x + 42, y - 38, 3, 0, Math.PI * 2);
    ctx.fill();
    
    // Eye shine
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x + 43, y - 39, 1, 0, Math.PI * 2);
    ctx.fill();
    
    // Tail
    ctx.fillStyle = "#f59e0b";
    ctx.shadowColor = "#f59e0b";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(x, y - 15);
    ctx.quadraticCurveTo(x - 15, y - 25, x - 10, y - 35);
    ctx.quadraticCurveTo(x - 5, y - 30, x + 5, y - 20);
    ctx.fill();
    
    // Legs (animated)
    ctx.shadowBlur = 0;
    const legOffset = Math.sin(frame * 0.5) * 5;
    // Back leg
    ctx.fillRect(x + 8, y - 5, 6, 8 + (frame % 2 === 0 ? legOffset : -legOffset));
    // Front leg
    ctx.fillRect(x + 25, y - 5, 6, 8 + (frame % 2 === 0 ? -legOffset : legOffset));
    
    // Arms
    ctx.fillRect(x + 30, y - 18, 8, 4);
    
    ctx.restore();
  };

  // Draw cactus
  const drawCactus = (ctx: CanvasRenderingContext2D, x: number, y: number, height: number) => {
    ctx.save();
    ctx.shadowColor = "#22c55e";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "#22c55e";
    
    // Main stem
    ctx.fillRect(x + 5, y - height, 10, height);
    
    // Arms
    if (height > 30) {
      // Left arm
      ctx.fillRect(x - 5, y - height + 15, 12, 6);
      ctx.fillRect(x - 5, y - height + 5, 6, 16);
      // Right arm
      ctx.fillRect(x + 13, y - height + 25, 12, 6);
      ctx.fillRect(x + 19, y - height + 15, 6, 16);
    }
    
    ctx.restore();
  };

  // Draw bird
  const drawBird = (ctx: CanvasRenderingContext2D, x: number, y: number, frame: number) => {
    ctx.save();
    ctx.shadowColor = "#ef4444";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "#ef4444";
    
    // Body
    ctx.beginPath();
    ctx.ellipse(x + 15, y, 15, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Beak
    ctx.beginPath();
    ctx.moveTo(x + 30, y);
    ctx.lineTo(x + 40, y + 2);
    ctx.lineTo(x + 30, y + 4);
    ctx.fill();
    
    // Wings (animated)
    ctx.shadowBlur = 0;
    const wingY = Math.sin(frame * 0.8) * 8;
    ctx.beginPath();
    ctx.moveTo(x + 10, y);
    ctx.quadraticCurveTo(x + 15, y - 15 + wingY, x + 25, y - 5 + wingY);
    ctx.quadraticCurveTo(x + 15, y - 5, x + 10, y);
    ctx.fill();
    
    // Eye
    ctx.fillStyle = "#0f172a";
    ctx.beginPath();
    ctx.arc(x + 22, y - 2, 2, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
  };

  useEffect(() => {
    if (gameState !== "playing") return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === "ArrowUp") {
        e.preventDefault();
        jump();
      }
    };

    // Mobile touch controls - tap anywhere to jump
    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      jump();
    };

    window.addEventListener("keydown", handleKeyDown);
    canvas.addEventListener("touchstart", handleTouchStart);

    const gameLoop = setInterval(() => {
      const g = gameRef.current;
      if (g.gameOver) return;

      g.frameCount++;
      g.dino.frame++;
      g.groundOffset = (g.groundOffset + g.speed) % 20;

      // Increase speed over time
      g.speed = 6 + Math.floor(g.score / 10) * 0.5;

      // Dino physics
      g.dino.vy += GRAVITY;
      g.dino.y += g.dino.vy;
      if (g.dino.y >= GROUND_Y) {
        g.dino.y = GROUND_Y;
        g.dino.vy = 0;
        g.dino.jumping = false;
      }

      // Spawn obstacles randomly
      const lastObstacle = g.obstacles[g.obstacles.length - 1];
      const minGap = 200 + Math.random() * 150;
      if (!lastObstacle || lastObstacle.x < CANVAS_WIDTH - minGap) {
        if (Math.random() < 0.02) {
          const type = Math.random() > 0.75 ? 'bird' : 'cactus';
          const height = type === 'cactus' ? 30 + Math.random() * 25 : 0;
          g.obstacles.push({ 
            x: CANVAS_WIDTH + 50, 
            type, 
            passed: false,
            height
          });
        }
      }

      // Move obstacles and check for passed
      g.obstacles.forEach(o => {
        o.x -= g.speed;
        // Score when obstacle passes dino
        if (!o.passed && o.x + 40 < 50) {
          o.passed = true;
          g.score++;
          setScore(g.score);
        }
      });
      g.obstacles = g.obstacles.filter(o => o.x > -60);

      // Collision detection
      const dinoBox = { x: 55, y: g.dino.y - 42, w: 35, h: 42 };
      for (const o of g.obstacles) {
        let oBox;
        if (o.type === 'cactus') {
          oBox = { x: o.x, y: GROUND_Y - o.height, w: 20, h: o.height };
        } else {
          oBox = { x: o.x, y: GROUND_Y - 50, w: 35, h: 16 };
        }
        
        if (dinoBox.x < oBox.x + oBox.w && dinoBox.x + dinoBox.w > oBox.x &&
            dinoBox.y < oBox.y + oBox.h && dinoBox.y + dinoBox.h > oBox.y) {
          g.gameOver = true;
          endGame(g.score);
          return;
        }
      }

      // Draw background
      const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
      gradient.addColorStop(0, "#0f172a");
      gradient.addColorStop(0.6, "#1e293b");
      gradient.addColorStop(1, "#334155");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Stars
      ctx.fillStyle = "#475569";
      for (let i = 0; i < 30; i++) {
        const x = (i * 47 + g.frameCount * 0.2) % CANVAS_WIDTH;
        const y = (i * 31) % 100;
        ctx.fillRect(x, y, 2, 2);
      }

      // Ground with texture
      ctx.strokeStyle = "#64748b";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, GROUND_Y + 10);
      ctx.lineTo(CANVAS_WIDTH, GROUND_Y + 10);
      ctx.stroke();
      
      // Ground details
      ctx.fillStyle = "#475569";
      for (let i = 0; i < 40; i++) {
        const x = ((i * 30 - g.groundOffset) % CANVAS_WIDTH + CANVAS_WIDTH) % CANVAS_WIDTH;
        ctx.fillRect(x, GROUND_Y + 15, 10, 2);
      }

      // Draw obstacles
      g.obstacles.forEach(o => {
        if (o.type === 'cactus') {
          drawCactus(ctx, o.x, GROUND_Y, o.height);
        } else {
          drawBird(ctx, o.x, GROUND_Y - 45, g.frameCount);
        }
      });

      // Draw dino
      drawDino(ctx, 50, g.dino.y, g.dino.jumping ? 0 : g.frameCount);

      // Score display with glow
      ctx.shadowColor = "#f59e0b";
      ctx.shadowBlur = 10;
      ctx.fillStyle = "#f59e0b";
      ctx.font = "bold 20px monospace";
      ctx.fillText(`🏆 ${g.score}`, CANVAS_WIDTH - 80, 35);
      ctx.shadowBlur = 0;
    }, 1000 / 60);

    return () => {
      clearInterval(gameLoop);
      window.removeEventListener("keydown", handleKeyDown);
      canvas.removeEventListener("touchstart", handleTouchStart);
    };
  }, [gameState, jump, endGame]);

  return (
    <div className="max-w-3xl mx-auto px-4">
      <div className="flex justify-between mb-6">
        <button onClick={onBack} className="flex items-center gap-2 text-foreground-muted hover:text-primary text-sm group transition-colors">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />Back
        </button>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500/20 to-amber-500/5 border border-amber-500/30">
            <Zap className="h-4 w-4 text-amber-400" />
            <span className="font-heading font-bold text-amber-400">Obstacles: {score}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background-secondary/50 border border-border">
            <Trophy className="h-4 w-4 text-xp" />
            <span className="font-bold text-xp">Best: {highScore}</span>
          </div>
        </div>
      </div>
      
      <div className="rounded-2xl bg-card border border-border p-4 sm:p-8 relative overflow-hidden shadow-[0_0_30px_rgba(245,158,11,0.1)]">
        <div className="absolute inset-0 rounded-2xl border border-amber-500/20" />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />
        
        <div className="flex flex-col items-center relative z-10">
          {gameState === "ready" && (
            <div className="text-center py-8">
              <div className="text-6xl mb-4">🦖</div>
              <h2 className="text-2xl font-heading font-bold mb-2 bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">Dino Runner</h2>
              <p className="text-foreground-muted mb-4">Jump over obstacles - endless runner!</p>
              <p className="text-sm text-xp mb-4">🎁 XP = Obstacles Passed</p>
              <Button onClick={startGame} className="gap-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500">
                <Gamepad2 className="h-4 w-4" /> Start Game
              </Button>
              <GameInstructions game="dino" />
            </div>
          )}
          
          {gameState === "playing" && (
            <div>
              <canvas 
                ref={canvasRef} 
                width={CANVAS_WIDTH} 
                height={CANVAS_HEIGHT}
                onClick={jump}
                className="rounded-lg border border-amber-500/30 shadow-[0_0_30px_rgba(245,158,11,0.2)] cursor-pointer"
              />
              <p className="text-center text-xs text-foreground-muted mt-2">Tap screen or press SPACE to jump</p>
            </div>
          )}
          
          {gameState === "ended" && (
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center py-8">
              <p className="text-2xl font-heading font-bold text-destructive mb-2">💀 Game Over!</p>
              <p className="text-foreground-muted mb-2">Obstacles passed: {score}</p>
              <p className="text-lg font-bold text-success mb-4">+{score} XP</p>
              <div className="flex justify-center gap-3">
                <Button onClick={startGame} variant="outline" className="gap-2 border-amber-500/50 hover:bg-amber-500/10">
                  <RotateCcw className="h-4 w-4" /> Play Again
                </Button>
                <Button onClick={onBack} className="bg-gradient-to-r from-amber-600 to-orange-600">Back to Games</Button>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
//  👾 SPACE INVADERS (Web Exclusive)
// ═══════════════════════════════════════════════════════════════════════════════

const SpaceInvadersGame = ({ onBack, onStart, onResult }: { onBack: () => void; onStart: () => void; onResult: (r: string, points: number) => void }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<"ready"|"playing"|"ended">("ready");
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [aliensKilled, setAliensKilled] = useState(0);
  
  const gameRef = useRef({
    player: { x: 225, y: 350 },
    bullets: [] as { x: number; y: number }[],
    aliens: [] as { x: number; y: number; alive: boolean }[],
    alienDir: 1,
    alienSpeed: 1,
    score: 0,
    kills: 0,
    gameOver: false,
    won: false,
    keys: { left: false, right: false },
    lastShot: 0
  });

  const startGame = () => {
    const aliens: { x: number; y: number; alive: boolean }[] = [];
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 8; col++) {
        aliens.push({ x: 60 + col * 50, y: 40 + row * 40, alive: true });
      }
    }
    
    gameRef.current = {
      player: { x: 225, y: 350 },
      bullets: [],
      aliens,
      alienDir: 1,
      alienSpeed: 1,
      score: 0,
      kills: 0,
      gameOver: false,
      won: false,
      keys: { left: false, right: false },
      lastShot: 0
    };
    setScore(0);
    setAliensKilled(0);
    setGameState("playing");
    onStart();
  };

  const endGame = useCallback((won: boolean, kills: number) => {
    setGameState("ended");
    setAliensKilled(kills);
    const finalScore = kills * 3;
    setScore(finalScore);
    if (finalScore > highScore) setHighScore(finalScore);
    // Report aliens destroyed; the server converts points to XP and caps it.
    onResult("won", kills);
  }, [highScore, onResult]);

  useEffect(() => {
    if (gameState !== "playing") return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const g = gameRef.current;
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") g.keys.left = true;
      if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") g.keys.right = true;
      if (e.code === "Space") {
        e.preventDefault();
        const now = Date.now();
        if (now - g.lastShot > 250) {
          g.bullets.push({ x: g.player.x + 15, y: g.player.y });
          g.lastShot = now;
        }
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      const g = gameRef.current;
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") g.keys.left = false;
      if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") g.keys.right = false;
    };

    // Mobile touch controls
    const handleTouchStart = (e: TouchEvent) => {
      const rect = canvas.getBoundingClientRect();
      const touchX = e.touches[0].clientX - rect.left;
      const g = gameRef.current;

      // Tap to shoot
      const now = Date.now();
      if (now - g.lastShot > 250) {
        g.bullets.push({ x: g.player.x + 15, y: g.player.y });
        g.lastShot = now;
      }

      // Left/right movement based on tap position
      if (touchX < canvas.width / 2) {
        g.keys.left = true;
        g.keys.right = false;
      } else {
        g.keys.right = true;
        g.keys.left = false;
      }
    };

    const handleTouchEnd = () => {
      const g = gameRef.current;
      g.keys.left = false;
      g.keys.right = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    canvas.addEventListener("touchstart", handleTouchStart);
    canvas.addEventListener("touchend", handleTouchEnd);

    const gameLoop = setInterval(() => {
      const g = gameRef.current;
      if (g.gameOver) return;

      // Move player
      if (g.keys.left && g.player.x > 0) g.player.x -= 5;
      if (g.keys.right && g.player.x < 450) g.player.x += 5;

      // Move bullets
      g.bullets.forEach(b => b.y -= 8);
      g.bullets = g.bullets.filter(b => b.y > 0);

      // Move aliens
      let moveDown = false;
      g.aliens.forEach(a => {
        if (a.alive) {
          a.x += g.alienDir * g.alienSpeed;
          if (a.x < 10 || a.x > 470) moveDown = true;
        }
      });
      
      if (moveDown) {
        g.alienDir *= -1;
        g.aliens.forEach(a => { if (a.alive) a.y += 20; });
        g.alienSpeed = Math.min(g.alienSpeed + 0.2, 4);
      }

      // Check bullet-alien collisions
      g.bullets.forEach((b, bi) => {
        g.aliens.forEach(a => {
          if (a.alive && b.x > a.x && b.x < a.x + 30 && b.y > a.y && b.y < a.y + 25) {
            a.alive = false;
            g.bullets.splice(bi, 1);
            g.kills++;
            g.score = g.kills * 3;
            setScore(g.score);
            setAliensKilled(g.kills);
          }
        });
      });

      // Check win condition
      if (g.aliens.every(a => !a.alive)) {
        g.gameOver = true;
        g.won = true;
        endGame(true, g.kills);
        return;
      }

      // Check lose condition (aliens reach bottom)
      if (g.aliens.some(a => a.alive && a.y > 320)) {
        g.gameOver = true;
        endGame(false, g.kills);
        return;
      }

      // Draw
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Stars background
      ctx.fillStyle = "#475569";
      for (let i = 0; i < 50; i++) {
        const x = (i * 37) % 500;
        const y = (i * 23 + Date.now() / 50) % 400;
        ctx.fillRect(x, y, 2, 2);
      }

      // Draw player with glow
      ctx.shadowColor = "#3b82f6";
      ctx.shadowBlur = 15;
      ctx.fillStyle = "#3b82f6";
      ctx.beginPath();
      ctx.moveTo(g.player.x + 15, g.player.y);
      ctx.lineTo(g.player.x, g.player.y + 30);
      ctx.lineTo(g.player.x + 30, g.player.y + 30);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;

      // Draw bullets
      ctx.shadowColor = "#22d3ee";
      ctx.shadowBlur = 10;
      ctx.fillStyle = "#22d3ee";
      g.bullets.forEach(b => {
        ctx.fillRect(b.x - 2, b.y, 4, 10);
      });
      ctx.shadowBlur = 0;

      // Draw aliens
      g.aliens.forEach(a => {
        if (a.alive) {
          ctx.shadowColor = "#a855f7";
          ctx.shadowBlur = 8;
          ctx.fillStyle = "#a855f7";
          ctx.fillRect(a.x, a.y, 30, 25);
          // Eyes
          ctx.shadowBlur = 0;
          ctx.fillStyle = "#0f172a";
          ctx.fillRect(a.x + 7, a.y + 8, 5, 5);
          ctx.fillRect(a.x + 18, a.y + 8, 5, 5);
        }
      });
    }, 1000 / 60);

    return () => {
      clearInterval(gameLoop);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchend", handleTouchEnd);
    };
  }, [gameState, endGame]);

  return (
    <div className="max-w-2xl mx-auto px-4">
      <div className="flex justify-between mb-6">
        <button onClick={onBack} className="flex items-center gap-2 text-foreground-muted hover:text-primary text-sm group transition-colors">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />Back
        </button>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-500/20 to-purple-500/5 border border-purple-500/30">
            <Skull className="h-4 w-4 text-purple-400" />
            <span className="font-heading font-bold text-purple-400">Kills: {aliensKilled}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background-secondary/50 border border-border">
            <Trophy className="h-4 w-4 text-xp" />
            <span className="font-bold text-xp">Best: {highScore}</span>
          </div>
        </div>
      </div>
      
      <div className="rounded-2xl bg-card border border-border p-4 sm:p-8 relative overflow-hidden shadow-[0_0_30px_rgba(168,85,247,0.1)]">
        <div className="absolute inset-0 rounded-2xl border border-purple-500/20" />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-purple-500/50 to-transparent" />
        
        <div className="flex flex-col items-center relative z-10">
          {gameState === "ready" && (
            <div className="text-center py-8">
              <Rocket className="h-16 w-16 mx-auto text-purple-400 mb-4 drop-shadow-[0_0_20px_rgba(168,85,247,0.5)]" />
              <h2 className="text-2xl font-heading font-bold mb-2 bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">Space Invaders</h2>
              <p className="text-foreground-muted mb-4">Destroy all the aliens!</p>
              <p className="text-sm text-xp mb-4">🎁 XP = Aliens × 3</p>
              <Button onClick={startGame} className="gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500">
                <Gamepad2 className="h-4 w-4" /> Start Game
              </Button>
              <GameInstructions game="invaders" />
            </div>
          )}
          
          {gameState === "playing" && (
            <div>
              <canvas 
                ref={canvasRef} 
                width={500} 
                height={400}
                className="rounded-lg border border-purple-500/30 shadow-[0_0_30px_rgba(168,85,247,0.2)]"
              />
              <p className="text-center text-xs text-foreground-muted mt-2">Tap left/right to move & shoot • Arrow keys/WASD + SPACE on desktop</p>
            </div>
          )}
          
          {gameState === "ended" && (
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center py-8">
              <p className={cn("text-2xl font-heading font-bold mb-2", gameRef.current.won ? "text-success" : "text-destructive")}>
                {gameRef.current.won ? "🎉 Victory!" : "💀 Game Over!"}
              </p>
              <p className="text-foreground-muted mb-2">Aliens destroyed: {aliensKilled}</p>
              <p className="text-lg font-bold text-success mb-4">+{aliensKilled * 3} XP</p>
              <div className="flex justify-center gap-3">
                <Button onClick={startGame} variant="outline" className="gap-2 border-purple-500/50 hover:bg-purple-500/10">
                  <RotateCcw className="h-4 w-4" /> Play Again
                </Button>
                <Button onClick={onBack} className="bg-gradient-to-r from-purple-600 to-pink-600">Back to Games</Button>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
//  GAMES LIST
// ═══════════════════════════════════════════════════════════════════════════════

const gamesList = [
  { id: "blackjack", name: "Blackjack", desc: "Beat the dealer to 21!", risk: "Bet XP", icon: Spade, color: "from-violet-500 to-purple-600", glow: "shadow-[0_0_30px_rgba(139,92,246,0.3)]", border: "hover:border-violet-500/50", requiresBet: true },
  { id: "rps", name: "Rock Paper Scissors", desc: "Win to earn XP!", risk: "Risk-free", icon: Hand, color: "from-emerald-500 to-green-600", glow: "shadow-[0_0_30px_rgba(16,185,129,0.3)]", border: "hover:border-emerald-500/50", requiresBet: false },
  { id: "hangman", name: "Hangman", desc: "Guess the word!", risk: "Free play", icon: Type, color: "from-cyan-500 to-blue-600", glow: "shadow-[0_0_30px_rgba(6,182,212,0.3)]", border: "hover:border-cyan-500/50", requiresBet: false },
  { id: "snake", name: "Snake", desc: "Eat pellets, don't crash!", risk: "Free play", icon: Bug, color: "from-green-500 to-emerald-600", glow: "shadow-[0_0_30px_rgba(34,197,94,0.3)]", border: "hover:border-green-500/50", requiresBet: false, webOnly: true },
  { id: "dino", name: "Dino Runner", desc: "Jump and survive!", risk: "Free play", icon: Zap, color: "from-amber-500 to-orange-600", glow: "shadow-[0_0_30px_rgba(245,158,11,0.3)]", border: "hover:border-amber-500/50", requiresBet: false, webOnly: true },
  { id: "invaders", name: "Space Invaders", desc: "Destroy the aliens!", risk: "Free play", icon: Rocket, color: "from-purple-500 to-pink-600", glow: "shadow-[0_0_30px_rgba(168,85,247,0.3)]", border: "hover:border-purple-500/50", requiresBet: false, webOnly: true }
];

const GAME_NAMES: Record<string, string> = {
  blackjack: 'Blackjack', rps: 'Rock Paper Scissors', hangman: 'Hangman', snake: 'Snake', dino: 'Dino Runner', invaders: 'Space Invaders'
};

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN GAMES COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

const Games = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: history, isLoading } = useGameHistory();
  const [game, setGame] = useState<GameType>("menu");
  const [bet, setBet] = useState(BLACKJACK_CONFIG.MIN_BET);
  const arcadeRun = useRef<number | null>(null);
  const notifyAchievements = useNotifyAchievements();

  const xp = Number(user?.user?.player_xp) || 0;
  const maxBet = Math.min(Math.floor(xp * BLACKJACK_CONFIG.MAX_BET_PERCENT), BLACKJACK_CONFIG.HARD_CAP);
  const canBet = maxBet >= BLACKJACK_CONFIG.MIN_BET;

  /** Refresh balance, history and leaderboard after any settled round. */
  const onSettled = useCallback(() => {
    invalidateProgress(qc);
    qc.invalidateQueries({ queryKey: ['games'] });
  }, [qc]);

  const arcadeStart = useCallback((type: ArcadeType) => {
    arcadeRun.current = null;
    gamesApi.arcadeStart(type).then((r) => { arcadeRun.current = r.sessionId; }).catch(showError);
  }, []);

  const arcadeFinish = useCallback(async (type: ArcadeType, points: number) => {
    const sessionId = arcadeRun.current;
    arcadeRun.current = null;
    if (!sessionId) return;
    try {
      const r = await gamesApi.arcadeFinish(type, sessionId, points);
      if (r.xpGained > 0) toast.success(`🎮 ${GAME_NAMES[type]} +${r.xpGained} XP!`, { description: r.bonusInfo?.details || undefined });
      else toast.info(points > 0 ? 'Daily free-game XP cap reached.' : `${GAME_NAMES[type]} - Game over! Try again.`);
      notifyAchievements(r.achievements);
      onSettled();
    } catch (err) {
      showError(err);
    }
  }, [onSettled, notifyAchievements]);

  const start = (id: string) => {
    const gameConfig = gamesList.find(g => g.id === id);
    if (gameConfig?.requiresBet && !canBet) {
      toast.error("Insufficient XP!", { description: `You need at least ${BLACKJACK_CONFIG.MIN_BET * 4} XP to bet (max bet is 25% of your balance).` });
      return;
    }
    if (gameConfig?.requiresBet && bet > maxBet) setBet(Math.max(BLACKJACK_CONFIG.MIN_BET, maxBet));
    setGame(id as GameType);
  };

  const back = () => setGame("menu");

  if (game === "blackjack") return <DashboardLayout><BlackjackGame onBack={back} bet={Math.min(bet, Math.max(maxBet, BLACKJACK_CONFIG.MIN_BET))} onSettled={onSettled} /></DashboardLayout>;
  if (game === "rps") return <DashboardLayout><RPSGame onBack={back} onSettled={onSettled} /></DashboardLayout>;
  if (game === "hangman") return <DashboardLayout><HangmanGame onBack={back} onSettled={onSettled} /></DashboardLayout>;
  if (game === "snake") return <DashboardLayout><SnakeGame onBack={back} onStart={() => arcadeStart("snake")} onResult={(_r, p) => arcadeFinish("snake", p)} /></DashboardLayout>;
  if (game === "dino") return <DashboardLayout><DinoGame onBack={back} onStart={() => arcadeStart("dino")} onResult={(_r, p) => arcadeFinish("dino", p)} /></DashboardLayout>;
  if (game === "invaders") return <DashboardLayout><SpaceInvadersGame onBack={back} onStart={() => arcadeStart("invaders")} onResult={(_r, p) => arcadeFinish("invaders", p)} /></DashboardLayout>;

  return (
    <DashboardLayout>
      <div className="px-4 sm:px-0">
        {/* Header with neon glow */}
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-heading font-bold mb-1 flex items-center gap-3">
            <div className="relative">
              <Gamepad2 className="h-8 w-8 text-primary drop-shadow-[0_0_10px_rgba(99,102,241,0.5)]" />
              <motion.div animate={{ scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] }} transition={{ repeat: Infinity, duration: 2 }} className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.8)]" />
            </div>
            <span className="bg-gradient-to-r from-primary via-cyan-400 to-primary bg-clip-text text-transparent">Game Center</span>
          </h1>
          <p className="text-foreground-muted text-sm sm:text-base">Test your luck and skills to win XP! Free games share a daily cap of {FREE_GAME_DAILY_CAP} XP.</p>
        </div>

        {/* Balance & Bet Section */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="flex-1 p-4 rounded-xl bg-gradient-to-r from-xp/20 via-xp/10 to-transparent border border-xp/30 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-xp/5 to-transparent" />
            <div className="relative z-10">
              <p className="text-xs text-foreground-muted mb-1">Your Balance</p>
              <p className="text-2xl font-heading font-bold text-xp drop-shadow-[0_0_10px_rgba(234,179,8,0.5)]">{xp.toLocaleString()} XP</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-card border border-border">
            <p className="text-xs text-foreground-muted mb-2 flex items-center gap-1">
              <Target className="h-3 w-3" /> Blackjack Bet
            </p>
            <div className="flex items-center gap-3">
              <NeonNumberInput value={bet} onChange={setBet} min={BLACKJACK_CONFIG.MIN_BET} max={Math.max(BLACKJACK_CONFIG.MIN_BET, maxBet)} step={5} />
              <div className="flex gap-1">
                {[10, 25, 50, 100].map(v => (
                  <button key={v} onClick={() => setBet(Math.min(v, maxBet))} disabled={v > maxBet} className={cn("px-2 py-1 text-xs rounded-md border transition-all", bet === v ? "bg-primary/20 border-primary/50 text-primary" : "bg-background-secondary border-border hover:border-primary/30 disabled:opacity-30")}>{v}</button>
                ))}
              </div>
            </div>
            <p className="text-xs text-foreground-muted mt-2">Min: {BLACKJACK_CONFIG.MIN_BET} • Max: {Math.max(0, maxBet)} (25% of balance)</p>
          </div>
        </div>

        {!canBet && (
          <div className="mb-6 p-4 rounded-xl bg-destructive/10 border border-destructive/30">
            <p className="text-sm text-destructive font-medium">⚠️ Not enough XP to bet</p>
            <p className="text-xs text-foreground-muted">Blackjack needs at least {BLACKJACK_CONFIG.MIN_BET * 4} XP. Try the free games below!</p>
          </div>
        )}

        {/* Games Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {gamesList.map((g, i) => (
            <motion.div key={g.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className={cn("group p-4 rounded-xl bg-card border border-border transition-all duration-300 cursor-pointer hover:scale-[1.02]", g.glow, g.border, g.requiresBet && !canBet && "opacity-50")} onClick={() => start(g.id)}>
              <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center bg-gradient-to-br mb-3 shadow-lg", g.color)}>
                <g.icon className="h-6 w-6 text-white drop-shadow-lg" />
              </div>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-heading font-bold text-lg flex items-center gap-2">
                    {g.name}
                    {g.webOnly && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">WEB</span>}
                  </h3>
                  <p className="text-sm text-foreground-muted">{g.desc}</p>
                </div>
                <div className={cn("text-xs px-2 py-1 rounded-full border", g.risk === "Risk-free" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : g.risk === "Free play" ? "bg-blue-500/10 text-blue-400 border-blue-500/30" : "bg-background-secondary text-foreground-muted border-border")}>{g.risk}</div>
              </div>
              <div className="flex items-center justify-end mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-sm text-primary font-medium flex items-center gap-1">Play <Zap className="h-4 w-4" /></span>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Game History */}
        <div className="mb-8">
          <h2 className="text-lg font-heading font-bold mb-4 flex items-center gap-2">
            <Trophy className="h-5 w-5 text-xp" />
            Recent Games
          </h2>
          <div className="rounded-xl bg-card border border-border overflow-hidden">
            {isLoading ? (
              <div className="p-8 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" /></div>
            ) : !history?.length ? (
              <div className="p-8 text-center text-foreground-muted">No games played yet. Try your luck!</div>
            ) : (
              history.slice(0, 10).map((e: GameSession) => {
                const gameInfo = gamesList.find(g => g.id === e.game_type);
                const stateLabel: Record<string, string> = { blackjack: 'Blackjack!', won: 'Won', lost: 'Lost', push: 'Push', expired: 'Expired (refunded)', cancelled: 'Quit' };
                return (
                  <div key={e.id} className="flex items-center justify-between p-3 sm:p-4 border-b border-border last:border-0 hover:bg-background-secondary/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center bg-gradient-to-br", gameInfo?.color || 'from-primary to-violet-600')}>
                        {gameInfo?.icon && <gameInfo.icon className="h-5 w-5 text-white" />}
                      </div>
                      <div>
                        <p className="font-medium text-sm sm:text-base">{GAME_NAMES[e.game_type] || e.game_type}</p>
                        <p className="text-xs text-foreground-muted">{new Date(e.ended_at || e.created_at).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={cn("font-bold", e.net > 0 ? "text-success" : e.net < 0 ? "text-destructive" : "text-foreground-muted")}>{e.net > 0 ? "+" : ""}{e.net} XP</p>
                      <p className={cn("text-xs", e.state === 'won' || e.state === 'blackjack' ? "text-success" : e.state === 'lost' ? "text-destructive" : "text-foreground-muted")}>{stateLabel[e.state] || e.state}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Games;
