import {
  Alliance,
  Game,
  Player,
  PlayerType,
} from "../src/core/game/Game";
import {
  canBreakRespawnAlliance,
  captureRespawnSnapshot,
  getRespawnSnapshot,
  isRespawnProtected,
  lockRespawnAllianceForBreaker,
  RESPAWN_ALLIANCE_LOCK_TICKS,
  RESPAWN_WAR_PROTECTION_TICKS,
  startRespawnProtection,
} from "../src/core/execution/RespawnState";

function fakePlayer(id: string): Player {
  return {
    id: () => id,
    type: () => PlayerType.Human,
    isAlive: () => true,
    numTilesOwned: () => 120,
    gold: () => 500_000n,
    troops: () => 42_000,
    units: () => [],
  } as unknown as Player;
}

describe("RespawnState", () => {
  test("captures money, territory and military situation", () => {
    let tick = 77;
    const game = { ticks: () => tick } as unknown as Game;
    const player = fakePlayer("respawning");

    captureRespawnSnapshot(game, player);

    expect(getRespawnSnapshot(player)).toEqual({
      tiles: 120,
      gold: 500_000n,
      troops: 42_000,
      structures: 0,
      tick: 77,
    });
    tick++;
  });

  test("five minute peace protection expires exactly after 3000 ticks", () => {
    let tick = 100;
    const game = { ticks: () => tick } as unknown as Game;
    const player = fakePlayer("protected");

    expect(RESPAWN_WAR_PROTECTION_TICKS).toBe(3000);
    startRespawnProtection(game, player);
    expect(isRespawnProtected(game, player)).toBe(true);

    tick = 100 + RESPAWN_WAR_PROTECTION_TICKS - 1;
    expect(isRespawnProtected(game, player)).toBe(true);

    tick = 100 + RESPAWN_WAR_PROTECTION_TICKS;
    expect(isRespawnProtected(game, player)).toBe(false);
  });

  test("ten minute forced alliance lock is directional", () => {
    let tick = 250;
    const game = { ticks: () => tick } as unknown as Game;
    const donor = fakePlayer("donor");
    const respawned = fakePlayer("respawned");
    const alliance = {} as Alliance;

    expect(RESPAWN_ALLIANCE_LOCK_TICKS).toBe(6000);
    lockRespawnAllianceForBreaker(game, alliance, donor);

    expect(canBreakRespawnAlliance(game, alliance, donor)).toBe(false);
    expect(canBreakRespawnAlliance(game, alliance, respawned)).toBe(true);

    tick = 250 + RESPAWN_ALLIANCE_LOCK_TICKS;
    expect(canBreakRespawnAlliance(game, alliance, donor)).toBe(true);
  });
});
