import PTSLogger from "./logger.js";
import { MODULE_ID, SOCKET, PROTOCOL_VERSION } from "./constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* -------------------------------------------- */
/* Utilities                                    */
/* -------------------------------------------- */

function parseTags(str) {
  return (str ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function taggerAvailable() {
  return (
    game.modules.get("tagger")?.active &&
    typeof Tagger?.getByTag === "function"
  );
}

/* -------------------------------------------- */
/* Query Application                             */
/* -------------------------------------------- */

export class PTSQueryApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "poi-tagger-search-query",
    window: { title: "Poi Tagger Search", resizable: false },
    position: { width: 380 },
    classes: ["poi-tagger-search"],
    actions: {
      search: PTSQueryApp.#onSearch,
      clear: PTSQueryApp.#onClear
    }
  };

  static PARTS = {
    content: {
      template: `modules/${MODULE_ID}/templates/query.hbs`
    }
  };

  async _prepareContext() {
    return {
      defaults: {
        mode: "map",
        match: "all",
        targets: "both"
      }
    };
  }

  /* -------------------------------------------- */
  /* Actions                                      */
  /* -------------------------------------------- */

  static async #onClear(event, target) {
    const app = this;
    const root = target.closest(".pts-root") ?? app.element;

    const audience = root.querySelector('[name="audience"]:checked')?.value ?? "me";
    const payload = { v: PROTOCOL_VERSION, action: "clear" };

    // Always clear locally
    game.modules.get(MODULE_ID)?.api?.dispatch?.(payload);

    // Broadcast only if requested
    if (audience === "everyone") {
      game.socket.emit(SOCKET, payload);
    }
  }


  static async #onSearch(event, target) {
    PTSLogger.log("Search button clicked");

    const app = this;
    const root = target.closest(".pts-root") ?? app.element;

    if (!taggerAvailable()) {
      ui.notifications.error("Tagger must be installed and enabled.");
      return;
    }

    const tags = parseTags(root.querySelector('[name="tags"]')?.value);
    if (!tags.length) {
      ui.notifications.warn("Enter at least one tag.");
      return;
    }

    const mode = root.querySelector('[name="mode"]:checked')?.value ?? "map";
    const match = root.querySelector('[name="match"]:checked')?.value ?? "all";
    const targets = root.querySelector('[name="targets"]:checked')?.value ?? "both";
    const audience = root.querySelector('[name="audience"]:checked')?.value ?? "me";

    let docs;
    try {
      docs = Tagger.getByTag(tags, {
        sceneId: canvas.scene.id,
        caseInsensitive: true,
        matchAny: match === "any"
      }) ?? [];
    } catch (err) {
      PTSLogger.error("Tagger query failed", err);
      ui.notifications.error("Tagger query failed. See console.");
      return;
    }

    const noteIds = [];
    const regionIds = [];

    for (const d of docs) {
      if (!d) continue;

      if (
        (targets === "notes" || targets === "both") &&
        d.documentName === "Note"
      ) {
        noteIds.push(d.id);
      }

      if (
        (targets === "regions" || targets === "both") &&
        d.documentName === "Region"
      ) {
        regionIds.push(d.id);
      }
    }

    const title = `PTS: ${tags.join(", ")} (${match.toUpperCase()})`;

    PTSLogger.log("Search executed", {
      tags,
      match,
      targets,
      notes: noteIds.length,
      regions: regionIds.length
    });

    const payload = {
      v: PROTOCOL_VERSION,
      action: "show",
      mode,
      title,
      noteIds,
      regionIds
    };

    // Always apply locally
    game.modules.get(MODULE_ID)?.api?.dispatch?.(payload);

    PTSLogger.log("Broadcast decision", { audience, willEmit: audience === "everyone" });

    // Broadcast only if requested
    if (audience === "everyone") {
      game.socket.emit(SOCKET, payload);
    }
  }
}

/* -------------------------------------------- */
/* Results List Application                      */
/* -------------------------------------------- */

export class PTSResultsListApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "poi-tagger-search-results",
    window: { title: "Poi Tagger Search", resizable: true },
    position: { width: 420, height: 520 },
    classes: ["poi-tagger-search"],
    actions: {
      pan: PTSResultsListApp.#onPan
    }
  };

  static PARTS = {
    content: {
      template: `modules/${MODULE_ID}/templates/list.hbs`
    }
  };

  constructor() {
    super();
    this._title = "Poi Tagger Search";
    this._noteIds = [];
    this._regionIds = [];
  }

  render(force, ctx = {}) {
    if (ctx?.title) this._title = ctx.title;
    if (Array.isArray(ctx?.noteIds)) this._noteIds = ctx.noteIds;
    if (Array.isArray(ctx?.regionIds)) this._regionIds = ctx.regionIds;
    return super.render(force);
  }

  async _prepareContext() {
    const notesById = new Map(
      (canvas.notes?.placeables ?? []).map(n => [n.document.id, n])
    );

    const regionsById = new Map(
      (canvas.regions?.placeables ?? []).map(r => [r.document.id, r])
    );

    const notes = this._noteIds
      .map(id => notesById.get(id))
      .filter(Boolean)
      .map(n => ({
        id: n.document.id,
        type: "note",
        name: (n.document.text ?? "").trim() || n.document.label || "Map Note"
      }));

    const regions = this._regionIds
      .map(id => regionsById.get(id))
      .filter(Boolean)
      .map(r => ({
        id: r.document.id,
        type: "region",
        name: r.document.name || r.document.label || "Region"
      }));

    return {
      title: this._title,
      notes,
      regions
    };
  }

  /* -------------------------------------------- */
  /* Actions                                      */
  /* -------------------------------------------- */

  static async #onPan(event, target) {
    const { id, type } = target.dataset;
    if (!canvas?.ready) return;

    if (type === "note") {
      const note = canvas.notes.placeables.find(n => n.document.id === id);
      if (!note) return;
      canvas.animatePan({
        x: note.document.x,
        y: note.document.y,
        scale: canvas.stage.scale.x
      });
      return;
    }

    if (type === "region") {
      const region = canvas.regions.placeables.find(r => r.document.id === id);
      if (!region) return;

      const b = region.bounds;
      const x = b ? b.x + b.width / 2 : region.document.x ?? 0;
      const y = b ? b.y + b.height / 2 : region.document.y ?? 0;

      canvas.animatePan({
        x,
        y,
        scale: canvas.stage.scale.x
      });
    }
  }
}
