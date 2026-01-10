import PTSLogger from "./logger.js";
import { MODULE_ID, SOCKET, PROTOCOL_VERSION } from "./constants.js";
import { PTSQueryApp, PTSResultsListApp } from "./app.js";

/* -------------------------------------------- */
/* Module State                                 */
/* -------------------------------------------- */

let queryApp = null;
let resultsListApp = null;
let overlay = null;
let overlayPulse = null; // function reference for PIXI.Ticker


/**
 * Client-side visual state only.
 * We never mutate documents.
 */
const state = {
  active: false,
  noteOriginals: new Map(),    // noteId -> { alpha, scale }
  regionOriginals: new Map()   // regionId -> { alpha }
};

/* -------------------------------------------- */
/* Utilities                                    */
/* -------------------------------------------- */
function clearOverlay() {
  stopOverlayPulse();
  if (!overlay) return;
  overlay.destroy({ children: true });
  overlay = null;
}

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = new PIXI.Container();
  overlay.name = "poi-tagger-search-overlay";
  canvas.stage.addChild(overlay);
  return overlay;
}

function startOverlayPulse() {
  stopOverlayPulse();

  let t = 0;
  overlayPulse = (delta) => {
    if (!overlay) return;
    t += delta;

    // Gentle: oscillate between ~0.65 and ~1.0 alpha
    overlay.alpha = 0.825 + 0.175 * Math.sin(t * 0.12);
  };

  PIXI.Ticker.shared.add(overlayPulse);
}


function stopOverlayPulse() {
  if (!overlayPulse) return;
  PIXI.Ticker.shared.remove(overlayPulse);
  overlayPulse = null;
}


function drawRectOutline(bounds, pad = 6) {
  const g = new PIXI.Graphics();
  g.lineStyle(3, 0x4da6ff, 1.0);
  g.drawRect(
    bounds.x - pad,
    bounds.y - pad,
    bounds.width + pad * 2,
    bounds.height + pad * 2
  );
  g.alpha = 0.95;
  return g;
}


function drawPing(x, y, radius = 18) {
  const g = new PIXI.Graphics();
  g.lineStyle(3, 0x4da6ff, 1.0);
  g.drawCircle(0, 0, radius);
  g.position.set(x, y);
  return g;
}


function getNotePlaceables(ids = []) {
  const placeables = canvas?.notes?.placeables ?? [];
  const map = new Map(placeables.map(n => [n.document.id, n]));
  return ids.map(id => map.get(id)).filter(Boolean);
}

function getRegionPlaceables(ids = []) {
  const placeables = canvas?.regions?.placeables ?? [];
  const map = new Map(placeables.map(r => [r.document.id, r]));
  return ids.map(id => map.get(id)).filter(Boolean);
}

/* -------------------------------------------- */
/* Highlight Management                         */
/* -------------------------------------------- */

function clearHighlights() {
  clearOverlay();

  // Restore notes
  for (const [id, orig] of state.noteOriginals) {
    const note = canvas.notes.placeables.find(n => n.document.id === id);
    if (!note?.icon) continue;
    note.icon.alpha = orig.alpha;
    note.icon.scale.set(orig.scale);
  }
  state.noteOriginals.clear();

  // Restore regions
  for (const [id, orig] of state.regionOriginals) {
    const region = canvas.regions.placeables.find(r => r.document.id === id);
    const obj = region?.mesh ?? region?.shape ?? region?.object;
    if (obj) obj.alpha = orig.alpha;
  }
  state.regionOriginals.clear();

  state.active = false;

  if (resultsListApp) resultsListApp.close();
}

function highlightNotes(noteIds) {
  const notes = getNotePlaceables(noteIds);

  // Existing “icon bump” (works when icons render)
  for (const note of notes) {
    if (!state.noteOriginals.has(note.document.id)) {
      state.noteOriginals.set(note.document.id, {
        alpha: note.alpha,
        scale: note.scale?.x ?? 1
      });
    }
    if (note.scale) note.scale.set(Math.max(note.scale.x, 1.15));
  }

  // New overlay pings (works even when pins are transparent)
  const layer = ensureOverlay();
  for (const note of notes) {
    layer.addChild(drawPing(note.document.x, note.document.y, 18));
  }

  startOverlayPulse();
}


function highlightRegions(regionIds) {
  const regions = getRegionPlaceables(regionIds);
  const layer = ensureOverlay();

  startOverlayPulse();

  PTSLogger.log("Overlay highlighting regions", { ids: regionIds, found: regions.length });

  const g = new PIXI.Graphics();
  g.lineStyle(3, 0x4da6ff, 1.0);
  g.alpha = 0.95;
  layer.addChild(g);

  for (const region of regions) {
    const shapes = region?.document?.shapes ?? [];
    for (const s of shapes) {
      if (!s || s.hole) continue;

      switch (s.type) {
        case "polygon": {
          const pts = s.points ?? [];
          if (pts.length < 6) break;

          g.moveTo(pts[0], pts[1]);
          for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
          g.lineTo(pts[0], pts[1]);
          break;
        }

        case "rectangle": {
          const { x = 0, y = 0, width = 0, height = 0, rotation = 0 } = s;
          if (!width || !height) break;

          const cx = x + width / 2;
          const cy = y + height / 2;
          const rad = (rotation || 0) * (Math.PI / 180);

          const corners = [
            { x: -width / 2, y: -height / 2 },
            { x:  width / 2, y: -height / 2 },
            { x:  width / 2, y:  height / 2 },
            { x: -width / 2, y:  height / 2 }
          ].map(p => ({
            x: cx + (p.x * Math.cos(rad) - p.y * Math.sin(rad)),
            y: cy + (p.x * Math.sin(rad) + p.y * Math.cos(rad))
          }));

          g.moveTo(corners[0].x, corners[0].y);
          for (let i = 1; i < corners.length; i++) g.lineTo(corners[i].x, corners[i].y);
          g.lineTo(corners[0].x, corners[0].y);
          break;
        }

        case "circle": {
          const { x = 0, y = 0, radius = 0 } = s;
          if (!radius) break;
          g.drawCircle(x, y, radius);
          break;
        }

        case "ellipse": {
          const { x = 0, y = 0, width = 0, height = 0, rotation = 0 } = s;
          if (!width || !height) break;

          const steps = 48;
          const rx = width / 2;
          const ry = height / 2;
          const rad = (rotation || 0) * (Math.PI / 180);

          let first = true;
          for (let i = 0; i <= steps; i++) {
            const t = (i / steps) * Math.PI * 2;
            const ex = Math.cos(t) * rx;
            const ey = Math.sin(t) * ry;

            const px = x + (ex * Math.cos(rad) - ey * Math.sin(rad));
            const py = y + (ex * Math.sin(rad) + ey * Math.cos(rad));

            if (first) {
              g.moveTo(px, py);
              first = false;
            } else {
              g.lineTo(px, py);
            }
          }
          break;
        }

        default:
          break;
      }
    }
  }
}


/* -------------------------------------------- */
/* Socket Handling                              */
/* -------------------------------------------- */

function onSocketMessage(payload) {
  if (!payload || payload.v !== PROTOCOL_VERSION) return;

  const { action } = payload;

  if (action === "clear") {
    PTSLogger.log("Clearing highlights");
    clearHighlights();
    return;
  }

  if (action === "show") {
    const { mode, noteIds = [], regionIds = [], title } = payload;

    PTSLogger.log("Show request received", {
      mode,
      notes: noteIds.length,
      regions: regionIds.length
    });

    clearHighlights();

    // ALWAYS highlight on the map
    highlightNotes(noteIds);
    highlightRegions(regionIds);
    state.active = true;

    // List mode ALSO opens the list window
    if (mode === "list") {
      if (!resultsListApp) resultsListApp = new PTSResultsListApp();
      resultsListApp.render(true, { title, noteIds, regionIds });
    }
  }

}

/* -------------------------------------------- */
/* Scene Controls                               */
/* -------------------------------------------- */

function registerSceneControls(controls) {
  const notes = controls?.notes;
  if (!notes) return;

    notes.tools.poiTaggerSearch = {
    name: "poiTaggerSearch",
    title: "Poi Tagger Search",
    icon: "fa-solid fa-tags",
    button: true,
    visible: game.user.isGM,
    onClick: () => {
      PTSLogger.log("CLick");    
      if (!queryApp) queryApp = new PTSQueryApp();
      queryApp.render(true);
    }
  };


  PTSLogger.log("Scene control registered");
}

/* -------------------------------------------- */
/* Hooks                                        */
/* -------------------------------------------- */

Hooks.once("init", () => {
  PTSLogger.log("Init");
});

Hooks.once("ready", () => {
  game.socket.on(SOCKET, (payload) => {
    PTSLogger.log("SOCKET RX", payload);
    onSocketMessage(payload);
  });


  // Local dispatch API so the sender also reacts immediately
    game.modules.get(MODULE_ID).api = {
      dispatch: (payload) => onSocketMessage(payload)
    };

    PTSLogger.log("API ready");  
});

Hooks.on("getSceneControlButtons", registerSceneControls);
