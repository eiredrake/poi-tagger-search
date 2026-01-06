import { POIQueryApp, POIListApp } from "./app.js";

const MODULE_ID = "poi-tagger-reveal";
const SOCKET = `module.${MODULE_ID}`;

let listApp = null;
let queryApp = null;

// Client-side “visual override” state
const state = {
  active: false,
  noteIds: [],
  originals: new Map() // noteId -> { alpha, scale }
};

function getNotesByIds(ids) {
  const placeables = canvas?.notes?.placeables ?? [];
  const byId = new Map(placeables.map(n => [n.document.id, n]));
  return ids.map(id => byId.get(id)).filter(Boolean);
}

function clearVisuals() {
  const placeables = canvas?.notes?.placeables ?? [];
  for (const n of placeables) {
    const orig = state.originals.get(n.document.id);
    if (!orig) continue;
    if (n.icon) n.icon.alpha = orig.alpha;
    if (n.icon) n.icon.scale.set(orig.scale);
  }
  state.originals.clear();
  state.active = false;
  state.noteIds = [];
}

function applyMapHighlight(ids) {
  clearVisuals();

  const notes = getNotesByIds(ids);
  for (const n of notes) {
    if (!n.icon) continue;
    state.originals.set(n.document.id, {
      alpha: n.icon.alpha,
      scale: n.icon.scale.x
    });

    // “Reveal” effect: make visible + slightly larger
    n.icon.alpha = 1.0;
    n.icon.scale.set(Math.max(n.icon.scale.x, 1.15));
  }

  state.active = true;
  state.noteIds = ids;
}

Hooks.once("init", () => {
  // Preload templates if you want; optional in v13
});

Hooks.once("ready", () => {
  // Socket receiver: GM broadcasts which notes to show + which mode
  game.socket.on(SOCKET, (payload) => {
    const { action } = payload ?? {};
    if (action === "clear") {
      clearVisuals();
      if (listApp) listApp.close();
      return;
    }

    if (action === "show") {
      const { mode, noteIds, title } = payload;
      if (mode === "map") {
        applyMapHighlight(noteIds);
        if (listApp) listApp.close();
      } else if (mode === "list") {
        clearVisuals();
        if (!listApp) listApp = new POIListApp();
        listApp.render(true, { noteIds, title });
      }
    }
  });
});

// Add the toolbar button under Map Notes
Hooks.on("getSceneControlButtons", (controls) => {
  const notes = controls.notes;
  if (!notes) return;

  notes.tools.poiTagSearch = {
    name: "poiTagSearch",
    title: "POI Tagger Search",
    icon: "fa-solid fa-tags",
    button: true,
    visible: game.user.isGM,
    onClick: () => {
      if (!queryApp) queryApp = new POIQueryApp({ moduleId: MODULE_ID, socket: SOCKET });
      queryApp.render(true);
    }
  };
});
