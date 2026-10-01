export function isIndependentReference(layer) {
  return layer?.sourceKind === "static" || ["limites", "otras"].includes(layer?.category);
}

// Catalog layers only: static references and uploadDraft.previewLayers never enter here.
export function createThematicSelection() {
  let current = null;
  return {
    get id() { return current?.id ?? null; },
    select(id) {
      current?.controller.abort();
      const ticket = { id, controller: new AbortController() };
      current = ticket;
      return Object.freeze({
        signal: ticket.controller.signal,
        current: () => current === ticket && !ticket.controller.signal.aborted,
      });
    },
    clear() { current?.controller.abort(); current = null; },
  };
}

export function latestThematicId(layers, orderedIds = []) {
  const valid = new Set(layers.filter(layer => layer.visible !== false && !isIndependentReference(layer)).map(layer => layer.id));
  return [...layers.map(layer => layer.id).filter(id => !orderedIds.includes(id)), ...orderedIds]
    .filter(id => valid.has(id)).at(-1) ?? null;
}
