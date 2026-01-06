const MODULE_ID = "poi-tagger-search";

function parseTags(str) {
  return (str ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

export class POISearchApp extends foundry.applications.api.ApplicationV2 {
  constructor(opts = {}) {
    super();
    this.moduleId = opts.moduleId ?? MODULE_ID;
    this.socket = opts.socket ?? `module.${this.moduleId}`;
  }

  static DEFAULT_OPTIONS = {
    id: "poi-tagger-search-query",
    window: { title: "POI Tag Reveal", resizable: false },
    position: { width: 360 },
    classes: ["poi-tagger-search"],
    actions: {
      show: POISearchApp.#onShow,
      clear: POISearchApp.#onClear
    }
  };

  async _renderHTML() {
    return await renderTemplate(`modules/${this.moduleId}/templates/query.hbs`, {
      defaultMode: "map",
      defaultMatch: "all"
    });
  }

  static async #onShow(event, target) {
    const app = this;
    const root = target.closest(".poi-tr-root") ?? app.element;

    const tagsStr = root.querySelector('[name="tags"]')?.value ?? "";
    const mode = root.querySelector('[name="mode"]:checked')?.value ?? "map";
    const match = root.querySelector('[name="match"]:checked')?.value ?? "all";

    if (!game.modules.get("tagger")?.active) {
      ui.notifications.error("Tagger module is required and must be active.");
      return;
    }

    const tags = parseTags(tagsStr);
    if (!tags.length) {
      ui.notifications.warn("Enter at least one tag.");
      return;
    }

    const opts = {
      sceneId: canvas.scene.id,
      caseInsensitive: true,
      matchAny: match === "any"
    };

    // Tagger returns Documents; we only want NoteDocuments in this scene
    const docs = Tagger.getByTag(tags, opts) ?? [];
    const noteIds = docs
      .filter(d => d?.documentName === "Note")
      .map(d => d.id);

    // Broadcast to all clients
    game.socket.emit(app.socket, {
      action: "show",
      mode,
      noteIds,
      title: `POIs: ${tags.join(", ")}`
    });
  }

  static async #onClear() {
    const app = this;
    game.socket.emit(app.socket, { action: "clear" });
  }
}

export class POIListApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "poi-tagger-search-list",
    window: { title: "POI Results", resizable: true },
    position: { width: 360, height: 480 },
    classes: ["poi-tagger-search"],
    actions: {
      pan: POIListApp.#onPan
    }
  };

  constructor() {
    super();
    this.noteIds = [];
    this.titleText = "POI Results";
  }

  render(force, ctx = {}) {
    if (ctx?.noteIds) this.noteIds = ctx.noteIds;
    if (ctx?.title) this.titleText = ctx.title;
    return super.render(force);
  }

  async _renderHTML() {
    const placeables = canvas?.notes?.placeables ?? [];
    const byId = new Map(placeables.map(n => [n.document.id, n]));

    const rows = this.noteIds
      .map(id => byId.get(id))
      .filter(Boolean)
      .map(n => ({
        id: n.document.id,
        name: n.document.text?.trim() || n.document.label || "POI",
        x: n.document.x,
        y: n.document.y
      }));

    return await renderTemplate(`modules/${MODULE_ID}/templates/list.hbs`, {
      title: this.titleText,
      rows
    });
  }

  static async #onPan(event, target) {
    const id = target.dataset.noteId;
    const note = (canvas?.notes?.placeables ?? []).find(n => n.document.id === id);
    if (!note) return;

    const { x, y } = note.document;
    canvas.animatePan({ x, y, scale: canvas.stage.scale.x });
  }
}
