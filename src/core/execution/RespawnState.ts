import { Alliance, Game, Player, PlayerType, Tick } from "../game/Game";

// OpenFront runs at 10 simulation ticks per second.
export const RESPAWN_WAR_PROTECTION_TICKS = 5 * 60 * 10;
export const RESPAWN_ALLIANCE_LOCK_TICKS = 10 * 60 * 10;

export interface RespawnSnapshot {
  tiles: number;
  gold: bigint;
  troops: number;
  tick: Tick;
}

const snapshots = new WeakMap<Player, RespawnSnapshot>();
const protectedUntil = new WeakMap<Player, Tick>();
const allianceBreakLocks = new WeakMap<Alliance, Map<string, Tick>>();

export function captureRespawnSnapshot(game: Game, player: Player): void {
  if (player.type() !== PlayerType.Human || !player.isAlive()) {
    return;
  }
  snapshots.set(player, {
    tiles: player.numTilesOwned(),
    gold: player.gold(),
    troops: player.troops(),
    tick: game.ticks(),
  });
}

export function getRespawnSnapshot(player: Player): RespawnSnapshot | null {
  return snapshots.get(player) ?? null;
}

export function startRespawnProtection(game: Game, player: Player): void {
  protectedUntil.set(player, game.ticks() + RESPAWN_WAR_PROTECTION_TICKS);
}

export function isRespawnProtected(game: Game, player: Player): boolean {
  return (protectedUntil.get(player) ?? -1) > game.ticks();
}

export function respawnProtectionTicksRemaining(
  game: Game,
  player: Player,
): number {
  return Math.max(0, (protectedUntil.get(player) ?? 0) - game.ticks());
}

export function lockRespawnAllianceForBreaker(
  game: Game,
  alliance: Alliance,
  breaker: Player,
): void {
  let locks = allianceBreakLocks.get(alliance);
  if (!locks) {
    locks = new Map<string, Tick>();
    allianceBreakLocks.set(alliance, locks);
  }
  locks.set(breaker.id(), game.ticks() + RESPAWN_ALLIANCE_LOCK_TICKS);
}

export function canBreakRespawnAlliance(
  game: Game,
  alliance: Alliance,
  breaker: Player,
): boolean {
  const until = allianceBreakLocks.get(alliance)?.get(breaker.id());
  return until === undefined || until <= game.ticks();
}

export function allianceHasActiveRespawnLock(
  game: Game,
  alliance: Alliance,
): boolean {
  const locks = allianceBreakLocks.get(alliance);
  if (!locks) return false;
  for (const until of locks.values()) {
    if (until > game.ticks()) return true;
  }
  return false;
}
