// Review follow-up: test whether R2 reparses punctuation inside one opaque tag.
// The fixture uses a real local-workerd ETag, not an invented matching ETag.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from '../harness/platform.mjs';
import { MemoryR2 } from '../harness/index.mjs';

let mf, real, externalAttempts = 0;
before(async () => {
  mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("TEST"); } };',
    compatibilityDate: '2026-07-01', r2Buckets: ['BUNDLES'], r2Persist: false, cf: false,
    outboundService: async () => { externalAttempts++; throw new Error('TEST external network forbidden'); } });
  await mf.ready;
  real = await mf.getR2Bucket('BUNDLES');
});
after(async () => { if (mf) await mf.dispose(); assert.equal(externalAttempts, 0); });

for (const [label, composite] of [
  ['current tag followed by comma and another tag', tag => `${tag},other_TEST`],
  ['another tag followed by comma and current tag', tag => `other_TEST,${tag}`],
  ['current tag followed by backslash', tag => `${tag}\\other_TEST`],
]) {
  test(`C18 HARNESS R2 treats ${label} as one literal mismatch`, async () => {
    async function trace(bucket) {
      const key = 'opaque_TEST';
      const base = await bucket.put(key, 'base_TEST');
      const value = composite(base.etag);
      const denied = await bucket.put(key, 'denied_TEST', { onlyIf: { etagMatches: value } });
      const kept = await bucket.get(key);
      assert.equal(denied, null, 'composite tag must not be parsed as alternative matching tags');
      assert.equal(kept.etag, base.etag);
      assert.equal(kept.uploaded.getTime(), base.uploaded.getTime());
      assert.equal(await kept.text(), 'base_TEST');
      const permitted = await bucket.put(key, 'next_TEST', { onlyIf: { etagDoesNotMatch: value } });
      assert.ok(permitted, 'the same literal mismatch must permit If-None-Match');
      assert.equal(await (await bucket.get(key)).text(), 'next_TEST');
    }
    await trace(real);
    await trace(new MemoryR2());
  });
}
