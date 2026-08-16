import { EventBus } from "../../../core/EventBus";
import { Controller } from "../../Controller";
import { SendTargetPlayerIntentEvent } from "../../Transport";
import { GameView } from "../../view";

const OVERLAY_ID = "respawn-country-overlay";

export class RespawnOverlay implements Controller {
  private root: HTMLDivElement | null = null;
  private button: HTMLButtonElement | null = null;

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
  ) {}

  init(): void {
    document.getElementById(OVERLAY_ID)?.remove();

    const root = document.createElement("div");
    root.id = OVERLAY_ID;
    root.style.position = "fixed";
    root.style.left = "50%";
    root.style.bottom = "max(32px, env(safe-area-inset-bottom))";
    root.style.transform = "translateX(-50%)";
    root.style.zIndex = "1600";
    root.style.display = "none";
    root.style.flexDirection = "column";
    root.style.alignItems = "center";
    root.style.gap = "8px";
    root.style.width = "min(92vw, 440px)";
    root.style.padding = "14px";
    root.style.border = "1px solid rgba(255,255,255,0.22)";
    root.style.borderRadius = "14px";
    root.style.background = "rgba(13, 18, 27, 0.92)";
    root.style.boxShadow = "0 12px 36px rgba(0,0,0,0.42)";
    root.style.backdropFilter = "blur(8px)";
    root.style.pointerEvents = "auto";

    const title = document.createElement("div");
    title.textContent = "국가가 멸망했습니다";
    title.style.fontSize = "16px";
    title.style.fontWeight = "700";
    title.style.color = "white";

    const description = document.createElement("div");
    description.textContent =
      "전쟁 중이 아닌 비슷한 국가로 복귀합니다. 부활 후 5분간 전쟁이 금지됩니다.";
    description.style.fontSize = "12px";
    description.style.lineHeight = "1.45";
    description.style.textAlign = "center";
    description.style.color = "rgba(255,255,255,0.74)";

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "부활하기";
    button.style.width = "100%";
    button.style.minHeight = "46px";
    button.style.border = "1px solid rgba(255,255,255,0.2)";
    button.style.borderRadius = "10px";
    button.style.background = "linear-gradient(135deg, #2563eb, #0d9488)";
    button.style.color = "white";
    button.style.fontSize = "16px";
    button.style.fontWeight = "800";
    button.style.cursor = "pointer";
    button.style.touchAction = "manipulation";
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const me = this.game.myPlayer();
      if (me === null || me.isAlive()) return;

      button.disabled = true;
      button.textContent = "부활 위치 찾는 중…";
      // The core executor recognizes a dead player's self-target as the
      // respawn command. This keeps the existing validated network protocol.
      this.eventBus.emit(new SendTargetPlayerIntentEvent(me.id()));

      window.setTimeout(() => {
        if (!this.game.myPlayer()?.isAlive()) {
          button.disabled = false;
          button.textContent = "부활하기";
        }
      }, 1500);
    };

    root.append(title, description, button);
    document.body.appendChild(root);
    this.root = root;
    this.button = button;
  }

  tick(): void {
    if (this.root === null || this.button === null) return;
    const me = this.game.myPlayer();
    const visible =
      !this.game.config().isReplay() &&
      !this.game.inSpawnPhase() &&
      me !== null &&
      me.hasSpawned() &&
      !me.isAlive();

    this.root.style.display = visible ? "flex" : "none";
    if (!visible) {
      this.button.disabled = false;
      this.button.textContent = "부활하기";
    }
  }

  getTickIntervalMs(): number {
    return 200;
  }
}
