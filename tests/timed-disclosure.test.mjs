import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimedDisclosure } from '../js/app/utils/timed-disclosure.js';
function fixture() {
  let now = 0, next = 0; const jobs = new Map(), changes = [];
  const disclosure = createTimedDisclosure({ onChange: open => changes.push(open), schedule(fn, ms) { jobs.set(++next, {at: now + ms, fn}); return next; }, cancel(id) { jobs.delete(id); } });
  return { disclosure, changes, advance(ms) { now += ms; for (const [id, job] of [...jobs]) if(job.at <= now) { jobs.delete(id); job.fn(); } } };
}
test('GOES information stays visible for seven seconds and can be consulted again', () => {
  const f = fixture(); f.disclosure.show(); f.advance(6999); assert.deepEqual(f.changes, [true]); f.advance(1); assert.deepEqual(f.changes,[true,false]); f.disclosure.show(); f.advance(7000); assert.deepEqual(f.changes,[true,false,true,false]);
});
test('focus and pointer independently pause reading; leaving the pointer does not override focus', () => {
  const f=fixture(); f.disclosure.show(); f.disclosure.pause('focus'); f.disclosure.pause('pointer'); f.advance(20000); f.disclosure.resume('pointer'); f.advance(20000); assert.deepEqual(f.changes,[true]); f.disclosure.resume('focus'); f.advance(7000); assert.deepEqual(f.changes,[true,false]);
});
test('actionable errors remain visible; manual dismissal stays dismissed until a new error', () => {
  const f=fixture(); f.disclosure.setPinned(true); f.advance(60000); assert.deepEqual(f.changes,[true]); f.disclosure.hide(); f.disclosure.setPinned(true); f.advance(60000); assert.deepEqual(f.changes,[true,false]); f.disclosure.setPinned(false); f.disclosure.setPinned(true); assert.deepEqual(f.changes,[true,false,true]);
});
test('after recovery an open error returns to the regular timeout', () => {
  const f=fixture(); f.disclosure.setPinned(true); f.disclosure.setPinned(false); f.advance(6999); assert.deepEqual(f.changes,[true]); f.advance(1); assert.deepEqual(f.changes,[true,false]);
});
