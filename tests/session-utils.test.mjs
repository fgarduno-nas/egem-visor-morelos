import test from 'node:test';
import assert from 'node:assert/strict';
import { restorableSession, loadPrivateCatalog } from '../js/app/utils/session-utils.js';

const token = exp => `header.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`;
const valid = role => ({ role, isAuthenticated: true, token: token(Date.now() / 1000 + 600) });

test('stored visitor, inconsistent, expired and malformed sessions become anonymous', () => {
  for (const session of [null, { ...valid('admin'), isAuthenticated: false }, valid('visitante'),
    { ...valid('admin'), token: token(1) }, { ...valid('director'), token: 'broken' },
    { ...valid('admin'), token: 'header.e30.signature' }, valid('unknown')]) {
    assert.equal(restorableSession(session), null);
  }
  for (const role of ['admin', 'director']) {
    const session = valid(role);
    assert.equal(restorableSession(session), session);
  }
  const demo = { role: 'director', isAuthenticated: true, token: null, source: 'local-demo' };
  assert.equal(restorableSession(demo), demo);
});

test('visitor and inconsistent sessions never request a private catalog', async () => {
  for (const session of [valid('visitante'), { ...valid('admin'), isAuthenticated: false }]) {
    const forbidden = () => assert.fail('private request is forbidden');
    assert.deepEqual(await loadPrivateCatalog(session, { currentSession: () => session,
      listAdmin: forbidden, listOwn: forbidden, onUnauthorized: forbidden }), []);
  }
});

test('expired token is retired before requesting; server 401 retires a revoked token once', async () => {
  for (const expired of [true, false]) {
    let session = { ...valid('admin'), ...(expired ? { token: token(1) } : {}) };
    let calls = 0, retired = 0;
    const options = { currentSession: () => session,
      listAdmin: async () => { calls++; throw Object.assign(new Error('Token inválido o expirado'), { status: 401 }); },
      onUnauthorized: () => { retired++; session = { role: 'visitante', isAuthenticated: false, token: null }; } };
    assert.deepEqual(await loadPrivateCatalog(session, options), []);
    assert.deepEqual(await loadPrivateCatalog(session, options), []);
    assert.equal(calls, expired ? 0 : 1);
    assert.equal(retired, 1);
  }
});

test('late private results or 401 cannot cross a logout or replace a new session', async () => {
  for (const fail of [false, true]) {
    const original = valid('admin'); let current = original, finish;
    const pending = loadPrivateCatalog(original, { currentSession: () => current,
      listAdmin: () => new Promise((resolve, reject) => { finish = () => fail ? reject({ status: 401 }) : resolve([{ id: 'private' }]); }),
      onUnauthorized: () => assert.fail('must not clear the newer session') });
    current = valid('director'); finish(); assert.deepEqual(await pending, []);
  }
});

test('valid director loads own catalog; other server failures remain observable', async () => {
  const session = valid('director');
  const options = { currentSession: () => session, listAdmin: () => assert.fail('wrong endpoint'),
    listOwn: async t => { assert.equal(t, session.token); return [{ id: 'own' }]; } };
  assert.deepEqual(await loadPrivateCatalog(session, options), [{ id: 'own' }]);
  for (const status of [403, 500]) {
    await assert.rejects(loadPrivateCatalog(session, { ...options,
      listOwn: async () => { throw Object.assign(new Error('server error'), { status }); } }), { status });
  }
});
