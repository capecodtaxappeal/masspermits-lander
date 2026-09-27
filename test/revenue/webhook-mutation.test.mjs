import test from 'node:test';
import assert from 'node:assert/strict';
import { loadHandlers, signedRequest, withWorld } from '../harness/index.mjs';

// Actual handlers, including isolated mutation copies selected by the runner.
const handlers = await loadHandlers({ sourceRoot: process.env.REVENUE_SOURCE_ROOT });
const NOW = '2026-10-01T00:05:00.000Z';
const SECONDS = Date.parse(NOW) / 1000;
const EMAIL = 'casey@example.com';
const OWNER = 'owner@example.com';
const CUSTOMER = 'cus_TEST_mutation';
const TOKEN = '2'.repeat(32);

function subscriber(overrides = {}) {
  return { email: EMAIL, name: 'TEST subscriber', customer: CUSTOMER,
    since: '2026-09-01', active: true, token: TOKEN, ...overrides };
}
function event(type, object = {}) {
  return { id: 'evt_TEST_mutation', type, created: SECONDS, livemode: false, data: { object } };
}
function checkout() {
  return event('checkout.session.completed', {
    id: 'cs_TEST_mutation', object: 'checkout.session', mode: 'subscription',
    amount_total: 9900, payment_status: 'paid', currency: 'usd',
    customer: CUSTOMER, subscription: 'sub_TEST_mutation',
    customer_details: { email: EMAIL, name: 'TEST subscriber' },
  });
}
function invoice(overrides = {}) {
  return { id: 'in_TEST_mutation', object: 'invoice', customer: CUSTOMER,
    customer_email: EMAIL, amount_paid: 0, amount_due: 9900, total: 9900,
    currency: 'usd', status: 'open', paid: false, billing_reason: 'subscription_cycle',
    subscription: 'sub_TEST_mutation', ...overrides };
}
async function using(fn, { rows = [subscriber()], ...options } = {}) {
  return withWorld(async (world) => {
    world.env.OWNER_EMAIL = OWNER;
    world.env.FROM_EMAIL = 'TEST sender <sender@example.com>';
    world.r2.set('subscribers.json', rows);
    world.r2.set('latest-monthly.zip', 'TEST monthly bytes');
    world.r2.set('latest-weekly.zip', 'TEST weekly bytes');
    return fn(world);
  }, { now: NOW, ...options });
}
async function invoke(world, payload, { header, ...signing } = {}) {
  const request = signedRequest(payload, signing);
  if (header === null) request.headers.delete('stripe-signature');
  else if (header !== undefined) request.headers.set('stripe-signature', header);
  const response = await world.call(handlers.webhook, request);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  return { response, body, text };
}
function assertNoEffects(world) {
  assert.equal(world.r2.ops.length, 0);
  assert.equal(world.mail.length, 0);
  assert.equal(world.fetchCalls.length, 0);
}
function assertOwnerOnly(world, count = 1) {
  assert.equal(world.mail.length, count);
  for (const mail of world.mail) {
    assert.deepEqual(mail.to, [OWNER]);
    assert.equal(mail.attachments, undefined);
  }
}
async function withCancellationDiagnostics(fn) {
  const original = console.log;
  const diagnostics = [];
  console.log = (...args) => {
    for (const value of args) {
      try {
        const entry = JSON.parse(String(value));
        if (entry.evt === 'cancellation_superseded') diagnostics.push(entry);
      } catch { /* No output from synthetic handler diagnostics. */ }
    }
  };
  try { return await fn(diagnostics); }
  finally { console.log = original; }
}

for (const [label, header, reason] of [
  ['absent header', null, 'no-signature-header'],
  ['empty header', '', 'no-signature-header'],
  ['absent timestamp', 'v1=' + '0'.repeat(64), 'header-missing-t-or-v1'],
  ['absent v1 field', 't=' + SECONDS, 'header-missing-t-or-v1'],
  ['empty timestamp', 't=,v1=' + '0'.repeat(64), 'header-missing-t-or-v1'],
  ['another signature scheme only', 't=' + SECONDS + ',v0=' + '0'.repeat(64), 'header-missing-t-or-v1'],
  ['empty v1 value', 't=' + SECONDS + ',v1=', 'hmac-mismatch'],
  ['short v1 value', 't=' + SECONDS + ',v1=TEST_short', 'hmac-mismatch'],
]) {
  test('I01 mutation contract rejects ' + label + ' before effects', async () => {
    await using(async (world) => {
      const result = await invoke(world, checkout(), { header });
      assert.equal(result.response.status, 400);
      assert.deepEqual(result.body, { error: 'bad signature', reason });
      assertNoEffects(world);
    });
  });
}

for (const secret of [undefined, null, '']) {
  test('I01 mutation contract rejects missing secret variant ' + String(secret), async () => {
    await using(async (world) => {
      world.env.STRIPE_WEBHOOK_SECRET = secret;
      const result = await invoke(world, checkout());
      assert.equal(result.response.status, 400);
      assert.deepEqual(result.body, { error: 'bad signature', reason: 'no-secret-in-env' });
      assertNoEffects(world);
    });
  });
}

test('I01 mutation contract accepts a valid second v1 signature with a padded configured secret', async () => {
  await using(async (world) => {
    const payload = checkout();
    const valid = signedRequest(payload).headers.get('stripe-signature');
    const [timestamp, signature] = valid.split(',');
    world.env.STRIPE_WEBHOOK_SECRET = ' \n' + world.env.STRIPE_WEBHOOK_SECRET + '\r\n ';
    const result = await invoke(world, payload, { header: timestamp + ',v1=' + '0'.repeat(64) + ',' + signature });
    assert.equal(result.response.status, 200);
    assert.equal(world.mail.length, 1);
    assert.deepEqual(world.mail[0].to, [EMAIL]);
    assert.equal(world.r2.json('subscribers.json').length, 1);
  }, { rows: [] });
});

test('I01 mutation contract rejects validly signed malformed JSON before effects', async () => {
  await using(async (world) => {
    const result = await invoke(world, '{TEST malformed JSON');
    assert.equal(result.response.status, 400);
    assert.equal(result.text, 'bad json');
    assertNoEffects(world);
  });
});

test('I04 mutation contract stores the UTC signup date and dated monthly attachment', async () => {
  await using(async (world) => {
    const result = await invoke(world, checkout());
    assert.equal(result.response.status, 200);
    const saved = world.r2.json('subscribers.json');
    assert.equal(saved[0].since, '2026-10-01');
    assert.equal(saved[0].active, true);
    assert.equal(world.mail[0].attachments[0].filename, 'MassPermits-monthly-2026-10-01.zip');
  }, { rows: [] });
});

test('I02 mutation contract gives a renewal the UTC weekly attachment date', async () => {
  await using(async (world) => {
    const result = await invoke(world, event('invoice.paid', invoice({ amount_paid: 9900, status: 'paid', paid: true })));
    assert.equal(result.response.status, 200);
    assert.equal(world.mail.length, 1);
    assert.equal(world.mail[0].attachments[0].filename, 'MassPermits-weekly-2026-10-01.zip');
  });
});

test('I16 mutation contract records cancellation UTC date once and preserves existing flags', async () => {
  const before = subscriber({ payment_failing: '2026-09-29', payment_detail: { attempt: 2 } });
  await using(async (world) => withCancellationDiagnostics(async (diagnostics) => {
    const payload = event('customer.subscription.deleted', { id: 'sub_TEST_mutation', customer: CUSTOMER });
    const first = await invoke(world, payload);
    assert.equal(first.body.deactivated, 1);
    const expected = { ...before, active: false, cancelled: '2026-10-01' };
    assert.deepEqual(world.r2.json('subscribers.json'), [expected]);
    world.setNow('2026-10-02T00:05:00.000Z');
    const second = await invoke(world, payload);
    assert.equal(second.body.deactivated, 0);
    assert.deepEqual(world.r2.json('subscribers.json'), [expected]);
    assert.equal(world.mail.length, 0);
    assert.deepEqual(diagnostics, []);
  }), { rows: [before] });
});

test('I16 I18 mutation contract permits legacy email cancellation with absent active and customer fields', async () => {
  const legacy = subscriber();
  delete legacy.active;
  delete legacy.customer;
  await using(async (world) => {
    const result = await invoke(world, event('customer.subscription.deleted', {
      id: 'sub_TEST_mutation', customer: CUSTOMER, customer_details: { email: EMAIL.toUpperCase() },
    }));
    assert.equal(result.body.deactivated, 1);
    assert.deepEqual(world.r2.json('subscribers.json'), [{ ...legacy, active: false, cancelled: '2026-10-01' }]);
    assert.equal(world.mail.length, 0);
  }, { rows: [legacy] });
});

test('I18 mutation contract matches cancellation by current ID when email changed', async () => {
  const other = subscriber({ email: 'casey+other@example.com', customer: 'cus_TEST_other', token: '3'.repeat(32) });
  await using(async (world) => withCancellationDiagnostics(async (diagnostics) => {
    const result = await invoke(world, event('customer.subscription.deleted', {
      id: 'sub_TEST_mutation', customer: CUSTOMER, customer_email: 'casey+changed@example.com',
    }));
    assert.equal(result.body.deactivated, 1);
    assert.deepEqual(world.r2.json('subscribers.json'), [
      { ...subscriber(), active: false, cancelled: '2026-10-01' }, other,
    ]);
    assert.deepEqual(diagnostics, []);
    assert.equal(world.mail.length, 0);
  }), { rows: [subscriber(), other] });
});

test('I18 mutation contract reports exactly the conflicting cancellation rows without revoking them', async () => {
  const before = subscriber();
  await using(async (world) => withCancellationDiagnostics(async (diagnostics) => {
    const result = await invoke(world, event('customer.subscription.deleted', {
      id: 'sub_TEST_old', customer: 'cus_TEST_old', customer_email: EMAIL,
    }));
    assert.equal(result.body.deactivated, 0);
    assert.deepEqual(world.r2.json('subscribers.json'), [before]);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].rows, 1);
    assert.equal(world.mail.length, 0);
  }), { rows: [before] });
});

test('I16 mutation contract cannot cancel without any identity', async () => {
  await using(async (world) => {
    const result = await invoke(world, event('customer.subscription.deleted', { id: 'sub_TEST_unresolved' }));
    assert.equal(result.body.deactivated, 0);
    assertNoEffects(world);
  });
});

test('I17 mutation contract preserves retry date evidence and informs only the owner', async () => {
  await using(async (world) => {
    const result = await invoke(world, event('invoice.payment_failed', invoice({
      attempt_count: 2, next_payment_attempt: Date.parse('2026-10-02T00:15:00Z') / 1000,
    })));
    assert.equal(result.body.flagged, true);
    assert.deepEqual(world.r2.json('subscribers.json'), [subscriber({
      payment_failing: '2026-10-01', payment_detail: { attempt: 2, nextAttempt: '2026-10-02', amount: 9900 },
    })]);
    assertOwnerOnly(world);
    assert.match(world.mail[0].subject, /^Payment FAILED:/);
    assert.ok(world.mail[0].html.includes('<b>' + EMAIL + '</b>'));
    assert.ok(world.mail[0].html.includes('Attempt 2'));
    assert.ok(world.mail[0].html.includes('2026-10-02'));
  });
});

test('I17 mutation contract explains absent event email and absent retry time to the owner', async () => {
  await using(async (world) => {
    const result = await invoke(world, event('invoice.payment_failed', invoice({ customer_email: null, attempt_count: 1 })));
    assert.equal(result.body.flagged, true);
    assert.equal(world.r2.json('subscribers.json')[0].payment_detail.nextAttempt, null);
    assertOwnerOnly(world);
    assert.ok(world.mail[0].html.includes('(no email on the event)'));
    assert.ok(world.mail[0].html.includes('no further automatic retry scheduled'));
    assert.equal(world.r2.json('subscribers.json')[0].active, true);
  });
});

// These fixtures explicitly provide resolved flat identity accepted by the
// handler. They are compatibility controls, not default Stripe risk schemas.
for (const [type, identity, label] of [
  ['review.opened', { customer_details: { email: EMAIL } }, 'Radar put a payment in review'],
  ['charge.dispute.created', { customer_email: EMAIL }, 'A charge was disputed (chargeback)'],
  ['radar.early_fraud_warning.created', { billing_details: { email: EMAIL } }, 'The bank flagged a charge as fraud'],
]) {
  test('I17 mutation contract holds resolved-identity compatibility event ' + type, async () => {
    await using(async (world) => {
      const result = await invoke(world, event(type, {
        id: 'risk_TEST_resolved', customer: CUSTOMER, reason: '<img src=x> TEST', ...identity,
      }));
      assert.equal(result.response.status, 200);
      assert.equal(result.body.stopped, 1);
      assert.deepEqual(world.r2.json('subscribers.json'), [subscriber({
        active: false, cancelled: '2026-10-01', payment_failing: '2026-10-01',
        payment_detail: { radar: type, at: NOW },
      })]);
      assertOwnerOnly(world);
      assert.ok(world.mail[0].subject.startsWith('HOLD (' + label + '):'));
      assert.ok(world.mail[0].html.includes('Weekly feed STOPPED'));
      assert.ok(world.mail[0].html.includes('&lt;img src=x&gt; TEST'));
      assert.equal(world.mail[0].html.includes('<img'), false);
    });
  });
}

for (const type of ['review.opened', 'charge.dispute.created', 'radar.early_fraud_warning.created']) {
  test('I17 mutation contract does not guess a subscriber for charge-only ' + type, async () => {
    await using(async (world) => {
      await invoke(world, event(type, { id: 'risk_TEST_unresolved', charge: 'ch_TEST_unresolved', payment_intent: 'pi_TEST_unresolved' }));
      assert.deepEqual(world.r2.json('subscribers.json'), [subscriber()]);
      assertOwnerOnly(world);
      assert.ok(world.mail[0].html.includes('No subscriber record matched'));
      // Do not assert that the current success-shaped response means a hold was
      // established. The unresolved-outcome contract remains a C14 policy TODO.
    });
  });
}

for (const reason of ['refunded', 'disputed', 'canceled', undefined]) {
  test('I17 mutation contract does not clear flags for non-approved review reason ' + String(reason), async () => {
    const before = subscriber({ payment_failing: '2026-09-29', payment_detail: { radar: 'review.opened' } });
    await using(async (world) => {
      const result = await invoke(world, event('review.closed', {
        id: 'prv_TEST_closed', customer: CUSTOMER, customer_email: EMAIL, closed_reason: reason,
      }));
      assert.equal(result.response.status, 200);
      assert.equal(result.body.review_closed, reason || 'unknown');
      assert.deepEqual(world.r2.json('subscribers.json'), [before]);
      assertNoEffects(world);
    }, { rows: [before] });
  });
}

test('I17 mutation contract awaits the approved-review owner transport and clears existing flags', async () => {
  const before = subscriber({ payment_failing: '2026-09-29', payment_detail: { radar: 'review.opened' } });
  await using(async (world) => {
    const closedFetch = globalThis.fetch;
    let release;
    let entered;
    const gate = new Promise((resolve) => { release = resolve; });
    const transportEntered = new Promise((resolve) => { entered = resolve; });
    const flights = [];
    globalThis.fetch = (input, init) => {
      const flight = (async () => {
        entered();
        await gate;
        return closedFetch(input, init);
      })();
      flights.push(flight);
      return flight;
    };
    let settled = false;
    const pending = invoke(world, event('review.closed', {
      id: 'prv_TEST_approved', customer: CUSTOMER, customer_email: EMAIL, closed_reason: 'approved',
    })).then((result) => { settled = true; return result; });
    let result;
    try {
      const first = await Promise.race([
        transportEntered.then(() => 'transport-entered'),
        pending.then(() => 'handler-settled'),
      ]);
      assert.equal(first, 'transport-entered', 'approved review must attempt its owner alert');
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(settled, false, 'acknowledgment must not detach the owner transport');
    } finally {
      release();
      try { result = await pending; }
      finally { await Promise.allSettled(flights); }
    }
    assert.equal(result.response.status, 200);
    assert.equal(result.body.review_closed, 'approved');
    assert.deepEqual(world.r2.json('subscribers.json'), [subscriber()]);
    assertOwnerOnly(world);
    assert.match(world.mail[0].subject, /^Radar review APPROVED:/);
    // Starting active avoids asserting the unchosen automatic reactivation policy.
  }, { rows: [before] });
});
