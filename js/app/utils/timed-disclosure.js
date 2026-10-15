// A transient disclosure pauses for reading, while actionable errors remain until dismissed.
export function createTimedDisclosure({ onChange, delay = 7000, schedule = setTimeout, cancel = clearTimeout }) {
  let timer, open = false, pinned = false;
  const pauses = new Set();
  const clear = () => { if (timer !== undefined) cancel(timer); timer = undefined; };
  const arm = () => { clear(); if (open && !pinned && !pauses.size) timer = schedule(hide, delay); };
  function hide() { clear(); pauses.clear(); open = false; onChange(false); }
  function show() { open = true; onChange(true); arm(); }
  return {
    show, hide,
    toggle() { if (open) hide(); else show(); },
    pause(reason = "reading") { pauses.add(reason); clear(); },
    resume(reason = "reading") { pauses.delete(reason); arm(); },
    setPinned(value) {
      if (pinned === value) return;
      pinned = value;
      if (pinned) show(); else arm();
    },
  };
}
