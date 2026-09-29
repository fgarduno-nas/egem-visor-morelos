import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudTopMapLayer, isExpectedCloudTopCancellation } from '../js/app/weather/cloud-top-layer.js';
const frame = { url: 'next.png', bounds: [-100, 18, -98, 20] };

test('GOES replacement marks only the exact cancellation reason of its previous request', async () => {
  const pending = new AbortController(); let eventError;
  const source = { _request: pending, updateImage() {
    pending.abort(); Promise.resolve().then(() => { eventError = pending.signal.reason; });
    this._request = new AbortController();
  } };
  const layer = new CloudTopMapLayer({ getSource: () => source });
  layer.upsertImageFrame(frame, undefined, 0);
  await Promise.resolve();
  assert.equal(isExpectedCloudTopCancellation(eventError), true);
  assert.equal(isExpectedCloudTopCancellation(new DOMException('unrelated abort', 'AbortError')), false);
  assert.equal(isExpectedCloudTopCancellation(new TypeError('Failed to fetch')), false);
  assert.equal(source._request.signal.aborted, false);
});

test('GOES removal cancellation is expected; a previously aborted or failed request is not', () => {
  const pending = new AbortController();
  const source = { _request: pending };
  const map = { getLayer: () => null, getSource: id => id.endsWith('-1') ? source : null,
    removeSource() { pending.abort(); } };
  new CloudTopMapLayer(map).destroy();
  assert.equal(isExpectedCloudTopCancellation(pending.signal.reason), true);
  const prior = new AbortController(); prior.abort();
  source._request = prior;
  source.updateImage = () => { throw prior.signal.reason; };
  assert.throws(() => new CloudTopMapLayer(map).upsertImageFrame(frame, undefined, 0), { name: 'AbortError' });
  assert.equal(isExpectedCloudTopCancellation(prior.signal.reason), false);
});

test('real updateImage failures are propagated, never classified as expected cancellation', () => {
  for (const error of [new TypeError('Failed to fetch'), new Error('HTTP 503'), new DOMException('unexpected', 'AbortError')]) {
    const source = { _request: new AbortController(), updateImage() { throw error; } };
    const layer = new CloudTopMapLayer({ getSource: () => source });
    assert.throws(() => layer.upsertImageFrame(frame, undefined, 0), e => e === error);
    assert.equal(isExpectedCloudTopCancellation(error), false);
  }
});
