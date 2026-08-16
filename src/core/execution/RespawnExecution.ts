import {
  Execution,
  Game,
  Player,
  PlayerType,
  Structures,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { simpleHash } from "../Util";
import { PlayerExecution } from "./PlayerExecution";
import {
  getRespawnSnapshot,
  lockRespawnAllianceForBreaker,
  RespawnSnapshot,
  startRespawnProtection,
} from "./RespawnState";

interface RespawnCandidate {
  player: Player;
  score: number;
}

interface CarveResult {
  donor: Player;
  tiles: TileRef[];
  surroundedByDonor: boolean;
}

function isAtWar(player: Player): boolean {
  return (
    player.incomingAttacks().some((attack) => attack.isActive()) ||
    player.outgoingAttacks().some((attack) => attack.isActive())
  );
}

function relativeDelta(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(1, Math.abs(b));
}

function goldScale(value: bigint): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  return Math.log1p(Number(value > max ? max : value));
}

function similarityScore(snapshot: RespawnSnapshot, candidate: Player): number {
  const territory = relativeDelta(candidate.numTilesOwned(), snapshot.tiles);
  const gold = relativeDelta(goldScale(candidate.gold()), goldScale(snapshot.gold));
  const troops = relativeDelta(candidate.troops(), snapshot.troops);
  const structures = relativeDelta(
    candidate.units(Structures.types).length,
    snapshot.structures,
  );
  return territory * 0.5 + gold * 0.2 + troops * 0.2 + structures * 0.1;
}

export class RespawnExecution implements Execution {
  private active = true;
  private mg: Game | null = null;

  constructor(private readonly player: Player) {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
  }

  tick(_ticks: number): void {
    if (this.mg === null) {
      throw new Error("RespawnExecution not initialized");
    }
    if (this.player.type() !== PlayerType.Human || this.player.isAlive()) {
      this.active = false;
      return;
    }

    const snapshot = getRespawnSnapshot(this.player);
    if (snapshot === null) {
      console.warn(`cannot respawn ${this.player.name()}: no death snapshot`);
      this.active = false;
      return;
    }

    const replacement = this.findSimilarCountry(snapshot);
    if (replacement !== null) {
      this.takeOverCountry(replacement);
      this.finishRespawn();
      return;
    }

    const targetTiles = Math.max(1, snapshot.tiles);
    const freeRegion = this.findUnownedCoastalRegion(targetTiles);
    if (freeRegion.length > 0) {
      this.createCountryOnTiles(freeRegion, snapshot);
      this.finishRespawn();
      return;
    }

    const carved = this.carveCoastalCountry(targetTiles);
    if (carved === null) {
      console.warn(`cannot respawn ${this.player.name()}: no coastal territory`);
      this.active = false;
      return;
    }

    this.createCountryOnTiles(carved.tiles, snapshot);
    if (carved.surroundedByDonor) {
      this.createProtectedAlliance(carved.donor);
    }
    this.finishRespawn();
  }

  private findSimilarCountry(snapshot: RespawnSnapshot): Player | null {
    if (this.mg === null) return null;
    const candidates: RespawnCandidate[] = [];
    for (const candidate of this.mg.players()) {
      if (candidate === this.player) continue;
      if (
        candidate.type() !== PlayerType.Bot &&
        candidate.type() !== PlayerType.Nation
      ) {
        continue;
      }
      if (isAtWar(candidate)) continue;

      const ratio = candidate.numTilesOwned() / Math.max(1, snapshot.tiles);
      if (ratio < 0.5 || ratio > 2) continue;

      candidates.push({
        player: candidate,
        score: similarityScore(snapshot, candidate),
      });
    }
    candidates.sort(
      (a, b) => a.score - b.score || a.player.id().localeCompare(b.player.id()),
    );
    const best = candidates[0];
    return best !== undefined && best.score <= 1.25 ? best.player : null;
  }

  private takeOverCountry(candidate: Player): void {
    const tiles = Array.from(candidate.tiles());
    const candidateGold = candidate.gold();
    const candidateTroops = candidate.troops();
    const structures = [...candidate.units(Structures.types)];

    for (const tile of tiles) {
      this.player.conquer(tile);
    }
    for (const unit of structures) {
      if (unit.isActive() && unit.owner() === candidate) {
        this.player.captureUnit(unit);
      }
    }

    candidate.removeGold(candidateGold);
    this.player.addGold(candidateGold);
    candidate.setTroops(0);
    this.player.setTroops(candidateTroops);
  }

  private createCountryOnTiles(
    tiles: readonly TileRef[],
    snapshot: RespawnSnapshot,
  ): void {
    for (const tile of tiles) {
      this.player.conquer(tile);
    }
    this.player.addGold(snapshot.gold);
    this.player.setTroops(snapshot.troops);
  }

  private findUnownedCoastalRegion(targetTiles: number): TileRef[] {
    if (this.mg === null) return [];
    const seen = new Set<TileRef>();
    let best: TileRef[] = [];

    this.mg.forEachTile((tile) => {
      if (
        seen.has(tile) ||
        this.mg === null ||
        !this.mg.isLand(tile) ||
        this.mg.isImpassable(tile) ||
        this.mg.hasOwner(tile) ||
        !this.mg.isOceanShore(tile)
      ) {
        return;
      }
      const region = this.growRegion(
        tile,
        targetTiles,
        (candidate) =>
          this.mg !== null &&
          this.mg.isLand(candidate) &&
          !this.mg.isImpassable(candidate) &&
          !this.mg.hasOwner(candidate),
        seen,
      );
      if (region.length > best.length) best = region;
    });

    // Prefer a reasonably similar territory. If the map only has a smaller
    // coastal remnant, use it rather than failing to respawn.
    return best.length >= Math.min(targetTiles, 10) ? best : [];
  }

  private carveCoastalCountry(targetTiles: number): CarveResult | null {
    if (this.mg === null) return null;

    const peaceful = this.mg
      .players()
      .filter((p) => p !== this.player && !isAtWar(p) && p.numTilesOwned() > 0);
    const preferred = peaceful.filter(
      (p) => p.type() === PlayerType.Bot || p.type() === PlayerType.Nation,
    );
    const donors = preferred.length > 0 ? preferred : peaceful;
    if (donors.length === 0) return null;

    const start = Math.abs(simpleHash(`${this.player.id()}:${this.mg.ticks()}`));
    const ordered = [...donors].sort((a, b) => a.id().localeCompare(b.id()));
    const rotated = ordered.map((_, i) => ordered[(start + i) % ordered.length]);

    let fallback: { donor: Player; tiles: TileRef[] } | null = null;
    for (const donor of rotated) {
      const coast = Array.from(donor.tiles()).filter((tile) =>
        this.mg!.isOceanShore(tile),
      );
      if (coast.length === 0) continue;

      const coastStart = Math.abs(
        simpleHash(`${donor.id()}:${this.player.id()}:${this.mg.ticks()}`),
      );
      const attempts = Math.min(coast.length, 12);
      for (let i = 0; i < attempts; i++) {
        const seed = coast[(coastStart + i) % coast.length];
        const region = this.growRegion(seed, targetTiles, (tile) => {
          return this.mg !== null && this.mg.owner(tile) === donor;
        });
        if (region.length > (fallback?.tiles.length ?? 0)) {
          fallback = { donor, tiles: region };
        }
        if (region.length >= targetTiles) {
          return {
            donor,
            tiles: region,
            surroundedByDonor: this.isLandBoundaryOwnedBy(region, donor),
          };
        }
      }
    }

    if (fallback === null || fallback.tiles.length === 0) return null;
    return {
      donor: fallback.donor,
      tiles: fallback.tiles,
      surroundedByDonor: this.isLandBoundaryOwnedBy(
        fallback.tiles,
        fallback.donor,
      ),
    };
  }

  private growRegion(
    seed: TileRef,
    limit: number,
    include: (tile: TileRef) => boolean,
    sharedSeen?: Set<TileRef>,
  ): TileRef[] {
    if (this.mg === null || !include(seed)) return [];
    const seen = sharedSeen ?? new Set<TileRef>();
    const localSeen = new Set<TileRef>();
    const queue: TileRef[] = [seed];
    const result: TileRef[] = [];
    localSeen.add(seed);
    seen.add(seed);
    let cursor = 0;
    const neighbors: TileRef[] = [0, 0, 0, 0];

    while (cursor < queue.length && result.length < limit) {
      const tile = queue[cursor++];
      if (!include(tile)) continue;
      result.push(tile);
      const count = this.mg.neighbors4(tile, neighbors);
      for (let i = 0; i < count; i++) {
        const neighbor = neighbors[i];
        if (localSeen.has(neighbor)) continue;
        localSeen.add(neighbor);
        seen.add(neighbor);
        if (include(neighbor)) queue.push(neighbor);
      }
    }
    return result;
  }

  private isLandBoundaryOwnedBy(
    region: readonly TileRef[],
    donor: Player,
  ): boolean {
    if (this.mg === null) return false;
    const regionSet = new Set(region);
    const neighbors: TileRef[] = [0, 0, 0, 0];
    let touchesDonor = false;

    for (const tile of region) {
      const count = this.mg.neighbors4(tile, neighbors);
      for (let i = 0; i < count; i++) {
        const neighbor = neighbors[i];
        if (regionSet.has(neighbor) || this.mg.isWater(neighbor)) continue;
        if (!this.mg.isLand(neighbor)) continue;
        if (this.mg.owner(neighbor) !== donor) return false;
        touchesDonor = true;
      }
    }
    return touchesDonor;
  }

  private createProtectedAlliance(donor: Player): void {
    if (this.mg === null || this.player.isAlliedWith(donor)) return;
    const request = this.player.createAllianceRequest(donor);
    request?.accept();
    const alliance = this.player.allianceWith(donor);
    if (alliance !== null) {
      // Only the donor/original country is locked. The respawned player can
      // break this alliance immediately if they choose.
      lockRespawnAllianceForBreaker(this.mg, alliance, donor);
    }
  }

  private finishRespawn(): void {
    if (this.mg === null || !this.player.isAlive()) {
      this.active = false;
      return;
    }
    startRespawnProtection(this.mg, this.player);
    // The original PlayerExecution stops when the player dies. Start a fresh
    // one so income, troops, structures and diplomacy continue normally.
    this.mg.addExecution(new PlayerExecution(this.player));
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
