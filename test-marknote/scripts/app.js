// Mock of ComfyUI's scripts/app.js — provides the minimal `app` surface that
// marknote.js depends on, plus a stub window.LiteGraph. marknote.js imports
// `{ app }` from here; harness.js imports the same module instance.
export const app = {
  registerExtension(ext) { window.__mnExt = ext; },
  canvas: {
    ds: { scale: 1, offset: [0, 0] },
    selectNode() {},
    setDirty() {},
  },
  graph: {
    _nodes: [],
    add(n) { this._nodes.push(n); },
    remove(n) { const i = this._nodes.indexOf(n); if (i >= 0) this._nodes.splice(i, 1); },
  },
};
window.__mnApp = app;
window.LiteGraph = {
  createNode() { return { properties: {}, pos: [0, 0], size: [0, 0], _mnEl: null }; },
};
