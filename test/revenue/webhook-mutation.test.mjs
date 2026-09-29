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

// Exhaustive-survivor controls. These isolate supported fallback fields rather
// than putting both identity forms into every otherwise-positive fixture.
test('I01 exhaustive contract rejects a full-length HMAC differing only in its first character', async () => {
  await using(async (world) => {
    const payload = checkout();
    const header = signedRequest(payload).headers.get('stripe-signature');
    const invalid = header.replace(/v1=([0-9a-f])/, (_, first) => 'v1=' + (first === '0' ? '1' : '0'));
    assert.notEqual(invalid, header);
    assert.equal(invalid.length, header.length);
    const result = await invoke(world, payload, { header: invalid });
    assert.equal(result.response.status, 400);
    assert.deepEqual(result.body, { error: 'bad signature', reason: 'hmac-mismatch' });
    assertNoEffects(world);
  });
});

for (const [label, mode, amount] of [
  ['zero-value one-time payment', 'payment', 0],
  ['one-cent subscription payment', 'subscription', 1],
]) {
  test('I02 exhaustive contract does not treat ' + label + ' as the zero-value trial exception', async () => {
    await using(async (world) => {
      const payload = checkout();
      Object.assign(payload.data.object, { mode, amount_total: amount });
      const result = await invoke(world, payload);
      assert.equal(result.response.status, 200);
      assert.equal(result.body.ok, true);
      assert.equal(result.body.skipped, 'checkout.session.completed');
      assertNoEffects(world);
    });
  });
}

test('I04 exhaustive compatibility contract enrolls a checkout using customer_email alone', async () => {
  await using(async (world) => {
    const payload = checkout();
    delete payload.data.object.customer_details;
    payload.data.object.customer_email = EMAIL;
    const result = await invoke(world, payload);
    assert.equal(result.response.status, 200);
    const saved = world.r2.json('subscribers.json');
    assert.equal(saved.length, 1);
    assert.equal(saved[0].email, EMAIL);
    assert.equal(saved[0].customer, CUSTOMER);
    assert.equal(saved[0].name, '');
    assert.equal(saved[0].active, true);
    assert.ok(saved[0].token);
    assert.deepEqual(world.mail[0].to, [EMAIL]);
    assert.ok(world.mail[0].html.includes('/api/my-leads?t=' + saved[0].token + '&k=monthly'));
  }, { rows: [] });
});

test('I17 I18 exhaustive compatibility contract flags a failed invoice using customer_details email alone', async () => {
  await using(async (world) => {
    const payload = invoice({ customer: undefined, customer_email: undefined,
      customer_details: { email: EMAIL.toUpperCase() } });
    const result = await invoke(world, event('invoice.payment_failed', payload));
    assert.equal(result.body.ok, true);
    assert.equal(result.body.flagged, true);
    assert.deepEqual(world.r2.json('subscribers.json'), [subscriber({
      payment_failing: '2026-10-01', payment_detail: { attempt: 0, nextAttempt: null, amount: 9900 },
    })]);
    assertOwnerOnly(world);
    assert.ok(world.mail[0].subject.includes(EMAIL.toUpperCase()));
    assert.ok(world.mail[0].html.includes('<b>' + EMAIL.toUpperCase() + '</b>'));
  });
});

test('I18 exhaustive contract flags the current customer despite changed email and preserves an unrelated row', async () => {
  const other = subscriber({ email: 'casey+other@example.com', customer: 'cus_TEST_other', token: '3'.repeat(32),
    payment_failing: '2026-09-20', payment_detail: { attempt: 5 } });
  await using(async (world) => {
    const result = await invoke(world, event('invoice.payment_failed', invoice({
      customer_email: 'casey+changed@example.com', attempt_count: 2,
    })));
    assert.equal(result.body.flagged, true);
    assert.deepEqual(world.r2.json('subscribers.json'), [subscriber({
      payment_failing: '2026-10-01', payment_detail: { attempt: 2, nextAttempt: null, amount: 9900 },
    }), other]);
    assertOwnerOnly(world);
    assert.ok(world.mail[0].subject.includes('casey+changed@example.com'));
  }, { rows: [subscriber(), other] });
});

test('I18 exhaustive contract backfills a missing customer ID while flagging a legacy email match', async () => {
  const legacy = subscriber();
  delete legacy.customer;
  await using(async (world) => {
    const result = await invoke(world, event('invoice.payment_failed', invoice({ customer_email: EMAIL.toUpperCase(), attempt_count: 1 })));
    assert.equal(result.body.flagged, true);
    assert.deepEqual(world.r2.json('subscribers.json'), [{ ...legacy, customer: CUSTOMER,
      payment_failing: '2026-10-01', payment_detail: { attempt: 1, nextAttempt: null, amount: 9900 },
    }]);
    assertOwnerOnly(world);
  }, { rows: [legacy] });
});

test('I18 exhaustive contract clears only the current customer when the recovery email changed', async () => {
  const before = subscriber({ payment_failing: '2026-09-29', payment_detail: { attempt: 2 } });
  const other = subscriber({ email: 'casey+other@example.com', customer: 'cus_TEST_other', token: '3'.repeat(32),
    payment_failing: '2026-09-20', payment_detail: { attempt: 5 } });
  await using(async (world) => {
    const result = await invoke(world, event('invoice.payment_succeeded', invoice({ customer_email: 'casey+changed@example.com' })));
    assert.equal(result.response.status, 200);
    assert.deepEqual(world.r2.json('subscribers.json'), [subscriber(), other]);
    assert.equal(world.mail.length, 0);
  }, { rows: [before, other] });
});

test('I18 exhaustive compatibility contract clears a recovered payment using customer_details email alone', async () => {
  const before = subscriber({ payment_failing: '2026-09-29', payment_detail: { attempt: 2 } });
  await using(async (world) => {
    await invoke(world, event('invoice.payment_succeeded', invoice({
      customer: undefined, customer_email: undefined, customer_details: { email: EMAIL.toUpperCase() },
    })));
    assert.deepEqual(world.r2.json('subscribers.json'), [subscriber()]);
    assert.equal(world.mail.length, 0);
  }, { rows: [before] });
});

test('I18 exhaustive contract persists recovery customer backfill even when no old payment flag exists', async () => {
  const legacy = subscriber();
  delete legacy.customer;
  await using(async (world) => {
    await invoke(world, event('invoice.payment_succeeded', invoice({ customer_email: EMAIL.toUpperCase() })));
    assert.deepEqual(world.r2.json('subscribers.json'), [{ ...legacy, customer: CUSTOMER }]);
    assert.equal(world.mail.length, 0);
  }, { rows: [legacy] });
});

test('I17 I18 exhaustive contract clears an already-active approved review by email when its customer ID is absent', async () => {
  const before = subscriber({ payment_failing: '2026-09-29', payment_detail: { radar: 'review.opened' } });
  await using(async (world) => {
    const result = await invoke(world, event('review.closed', {
      id: 'prv_TEST_email_only', customer_email: EMAIL.toUpperCase(), closed_reason: 'approved',
    }));
    assert.equal(result.body.ok, true);
    assert.deepEqual(world.r2.json('subscribers.json'), [subscriber()]);
    assertOwnerOnly(world);
    assert.ok(world.mail[0].subject.includes(EMAIL.toUpperCase()));
  }, { rows: [before] });
});

// Flat risk identities below are deliberate compatibility fixtures, not a claim
// about ordinary Stripe charge/review schemas or unresolved charge expansion.
for (const [type, identity] of [
  ['review.opened', { customer_details: { email: EMAIL } }],
  ['charge.dispute.created', { customer_email: EMAIL }],
  ['radar.early_fraud_warning.created', { billing_details: { email: EMAIL } }],
]) {
  test('I17 I18 exhaustive compatibility contract holds ' + type + ' using its email fallback without a customer ID', async () => {
    const other = subscriber({ email: 'casey+other@example.com', customer: 'cus_TEST_other', token: '3'.repeat(32) });
    await using(async (world) => {
      const result = await invoke(world, event(type, { id: 'risk_TEST_email_only', ...identity }));
      assert.equal(result.body.ok, true);
      assert.equal(result.body.stopped, 1);
      assert.deepEqual(world.r2.json('subscribers.json'), [subscriber({ active: false, cancelled: '2026-10-01',
        payment_failing: '2026-10-01', payment_detail: { radar: type, at: NOW },
      }), other]);
      assertOwnerOnly(world);
      assert.ok(world.mail[0].subject.includes(EMAIL));
      assert.ok(world.mail[0].html.includes('<b>' + EMAIL + '</b>'));
    }, { rows: [subscriber(), other] });
  });
}

test('I17 exhaustive compatibility contract holds a resolved risk by customer ID with no email fields', async () => {
  await using(async (world) => {
    const result = await invoke(world, event('review.opened', { id: 'risk_TEST_id_only', customer: CUSTOMER }));
    assert.equal(result.body.stopped, 1);
    assert.deepEqual(world.r2.json('subscribers.json'), [subscriber({ active: false, cancelled: '2026-10-01',
      payment_failing: '2026-10-01', payment_detail: { radar: 'review.opened', at: NOW },
    })]);
    assertOwnerOnly(world);
    assert.ok(world.mail[0].subject.includes(CUSTOMER));
    assert.ok(world.mail[0].html.includes('(no email on the event)'));
    assert.ok(world.mail[0].html.includes('<code>' + CUSTOMER + '</code>'));
  });
});

for (const [label, identity] of [
  ['no identity', { customer: undefined, customer_email: undefined }],
  ['an unrelated identity', { customer: 'cus_TEST_unrelated', customer_email: 'casey+unrelated@example.com' }],
]) {
  test('I18 exhaustive contract does not claim to flag a failed invoice with ' + label, async () => {
    await using(async (world) => {
      const result = await invoke(world, event('invoice.payment_failed', invoice(identity)));
      assert.equal(result.body.flagged, false);
      assert.deepEqual(world.r2.json('subscribers.json'), [subscriber()]);
      assertOwnerOnly(world);
      assert.ok(world.mail[0].html.includes('NOT FOUND'));
    });
  });
}

for (const fault of ['get failure', 'malformed JSON', 'non-array JSON']) {
  test('I02 exhaustive contract cannot deliver a zero-value renewal after roster ' + fault, async () => {
    await using(async (world) => {
      if (fault === 'get failure') {
        // Recovery attempts one read before the independent zero-value gate.
        world.r2.failNext('get', 'subscribers.json');
        world.r2.failNext('get', 'subscribers.json');
      } else world.r2.set('subscribers.json', fault === 'malformed JSON' ? '{TEST malformed' : { TEST: [] });
      const result = await invoke(world, event('invoice.paid', invoice({
        amount_paid: 0, total: 0, amount_due: 0, paid: true, status: 'paid',
      })));
      assert.equal(result.body?.delivered, undefined);
      assert.equal(world.mail.length, 0);
      assert.equal(world.fetchCalls.length, 0);
      assert.equal(world.r2.ops.some((op) => op.op === 'get' && op.key === 'latest-weekly.zip'), false);
      // A future explicit storage error is acceptable. Do not pin the current
      // success-shaped "not ours" explanation as the right error contract.
    });
  });
}

test('I04 exhaustive contract persists a legitimate same-customer re-enrollment and preserves its download token', async () => {
  const before = subscriber({ active: false, cancelled: '2026-09-29' });
  await using(async (world) => {
    const result = await invoke(world, checkout());
    assert.equal(result.response.status, 200);
    assert.deepEqual(world.r2.json('subscribers.json'), [subscriber()]);
    assert.equal(world.mail.length, 1);
    assert.ok(world.mail[0].html.includes('/api/my-leads?t=' + TOKEN + '&k=monthly'));
  }, { rows: [before] });
});

test('I04 exhaustive contract durably backfills a missing download token on an unchanged current customer', async () => {
  const before = subscriber();
  delete before.token;
  await using(async (world) => {
    const result = await invoke(world, checkout());
    assert.equal(result.response.status, 200);
    const saved = world.r2.json('subscribers.json');
    assert.equal(saved.length, 1);
    assert.ok(saved[0].token);
    assert.deepEqual({ ...saved[0], token: undefined }, { ...before, token: undefined });
    assert.ok(world.mail[0].html.includes('/api/my-leads?t=' + saved[0].token + '&k=monthly'));
  }, { rows: [before] });
});

test('I04 I18 exhaustive contract preserves an existing customer ID when a repeated checkout omits it', async () => {
  await using(async (world) => {
    const payload = checkout();
    delete payload.data.object.customer;
    await invoke(world, payload);
    assert.deepEqual(world.r2.json('subscribers.json'), [subscriber()]);
    assert.ok(world.mail[0].html.includes('/api/my-leads?t=' + TOKEN + '&k=monthly'));
  });
});

test('I05 exhaustive contract records one valid referral and sends its instruction only to the configured owner', async () => {
  await using(async (world) => {
    const referrer = 'casey+referrer@example.com';
    world.r2.set('referral/codes/testcode', { email: referrer, ts: NOW });
    const payload = checkout();
    payload.data.object.client_reference_id = 'ref-testcode';
    const result = await invoke(world, payload);
    assert.equal(result.response.status, 200);
    const writes = world.r2.ops.filter((op) => op.op === 'put' && op.key.startsWith('referral/credits/'));
    assert.equal(writes.length, 1);
    assert.deepEqual(world.r2.json(writes[0].key), { code: 'testcode', referrer, buyer: EMAIL, ts: NOW });
    assert.equal(world.mail.length, 2);
    assert.deepEqual(world.mail[0].to, [EMAIL]);
    assert.deepEqual(world.mail[1].to, [OWNER]);
    assert.equal(world.mail[1].attachments, undefined);
    assert.ok(world.mail[1].html.includes(referrer));
    assert.ok(world.mail[1].html.includes(EMAIL));
    assert.equal(world.mail[0].html.includes('Your selection:'), false);
    const link = /href="https:\/\/masspermits\.com\/r\/([a-z0-9]{4,24})"/.exec(world.mail[0].html);
    assert.ok(link, 'new buyer receives a usable stored referral link');
    assert.deepEqual(world.r2.json('referral/codes/' + link[1]), { email: EMAIL, ts: NOW });
    // This asserts attribution plus an owner instruction, not actual credit
    // application, provider receipt, or replay idempotency (the C03 TODO).
  });
});

for (const [label, reference, code, storedEmail] of [
  ['self-referral with different email case', 'ref-testcode', 'testcode', EMAIL.toUpperCase()],
  ['unknown referral code', 'ref-unknowncode', null, null],
  ['invalid short referral code even if an object exists', 'ref-abc', 'abc', 'casey+referrer@example.com'],
  ['ordinary trade selection that resembles a stored suffix', 'plumbing', 'bing', 'casey+referrer@example.com'],
]) {
  test('I05 exhaustive contract creates no referral credit for ' + label, async () => {
    await using(async (world) => {
      if (code) world.r2.set('referral/codes/' + code, { email: storedEmail, ts: NOW });
      const payload = checkout();
      payload.data.object.client_reference_id = reference;
      const result = await invoke(world, payload);
      assert.equal(result.response.status, 200);
      assert.equal(world.mail.length, 1);
      assert.deepEqual(world.mail[0].to, [EMAIL]);
      assert.equal(world.r2.ops.some((op) => op.op === 'put' && op.key.startsWith('referral/credits/')), false);
      if (reference === 'plumbing') assert.ok(world.mail[0].html.includes('Your selection: <b>plumbing</b>'));
    });
  });
}

test('I02 I04 exhaustive contract appends renewal evidence and renders weekly wording without a referral block', async () => {
  await using(async (world) => {
    const previous = { at: '2026-09-28T14:00:00.000Z', to: 'casey+other@example.com',
      kind: 'monthly', bundle: 'latest-monthly.zip' };
    world.r2.set('delivery-log.json', [previous]);
    const result = await invoke(world, event('invoice.paid', invoice({ amount_paid: 9900, paid: true, status: 'paid' })));
    assert.equal(result.response.status, 200);
    assert.deepEqual(world.r2.json('delivery-log.json'), [
      { at: NOW, to: EMAIL, kind: 'weekly', bundle: 'latest-weekly.zip' }, previous,
    ]);
    assert.equal(world.mail.length, 1);
    assert.equal(world.mail[0].subject, 'Your weekly MassPermits leads');
    assert.ok(world.mail[0].html.includes("Here is this week's fresh building-permit lead bundle."));
    assert.equal(world.mail[0].html.includes('masspermits.com/r/'), false);
    assert.equal(world.r2.ops.some((op) => op.key.startsWith('referral/')), false);
  });
});

// Hold a real fake-store/closed-transport operation before it takes effect. The
// handler still runs unchanged. Every test races entry against acknowledgment,
// releases the hold in finally, and drains detached work before world.restore.
function deferOperation(target, property, matches) {
  const original = target[property];
  let enter;
  let release;
  const started = new Promise((resolve) => { enter = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const flights = [];
  target[property] = function (...args) {
    if (!matches(...args)) return Reflect.apply(original, this, args);
    const receiver = this;
    const flight = (async () => {
      enter(args);
      await gate;
      return Reflect.apply(original, receiver, args);
    })();
    flights.push(flight);
    // Keep a detached mutant's rejection observable to cleanup without an
    // unhandled rejection caused by this test wrapper itself.
    void flight.catch(() => {});
    return flight;
  };
  return {
    started, release,
    async restore() {
      release();
      try {
        let seen;
        do {
          seen = flights.length;
          await Promise.allSettled(flights);
          await new Promise((resolve) => setImmediate(resolve));
        } while (flights.length !== seen);
      } finally { target[property] = original; }
    },
  };
}

async function invokeWhileDeferred(world, payload, deferred, inspect) {
  let settled = false;
  const pending = invoke(world, payload).then(
    (result) => { settled = true; return result; },
    (error) => { settled = true; throw error; },
  );
  let result;
  try {
    const first = await Promise.race([
      deferred.started.then((args) => ({ kind: 'operation-entered', args })),
      pending.then(() => ({ kind: 'handler-settled' })),
    ]);
    assert.equal(first.kind, 'operation-entered', 'required effect must be attempted before acknowledgment');
    // Closed in-memory effects after a removed await get an event-loop turn to
    // finish. No timer stands in for releasing the operation under observation.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false, 'acknowledgment cannot detach a required pending effect');
    await inspect(first.args);
  } finally {
    deferred.release();
    try { result = await pending; }
    finally { await deferred.restore(); }
  }
  return result;
}

const isOwnerTransport = (input, init) => input === 'https://api.resend.com/emails' &&
  JSON.parse(init.body).to.includes(OWNER);
const rosterWriteWhere = (predicate) => (key, value) => key === 'subscribers.json' && predicate(JSON.parse(value)[0]);

test('I17 closure contract awaits the failed-payment owner transport and identifies an ID-only customer', async () => {
  await using(async (world) => {
    const deferred = deferOperation(globalThis, 'fetch', isOwnerTransport);
    const result = await invokeWhileDeferred(world, event('invoice.payment_failed', invoice({ customer_email: null })), deferred, () => {
      assert.equal(world.r2.json('subscribers.json')[0].payment_failing, '2026-10-01');
      assert.equal(world.mail.length, 0);
    });
    assert.equal(result.body.ok, true);
    assertOwnerOnly(world);
    assert.ok(world.mail[0].subject.includes(CUSTOMER));
    assert.ok(world.mail[0].html.includes('<code>' + CUSTOMER + '</code>'));
  });
});

test('I17 closure compatibility contract awaits the resolved-risk owner transport after persisting its hold', async () => {
  await using(async (world) => {
    const deferred = deferOperation(globalThis, 'fetch', isOwnerTransport);
    const result = await invokeWhileDeferred(world, event('review.opened', {
      id: 'risk_TEST_delayed_owner', customer: CUSTOMER, customer_email: EMAIL,
    }), deferred, () => {
      const saved = world.r2.json('subscribers.json')[0];
      assert.equal(saved.active, false);
      assert.equal(saved.payment_failing, '2026-10-01');
      assert.equal(world.mail.length, 0);
    });
    assert.equal(result.body.stopped, 1);
    assertOwnerOnly(world);
  });
});

test('I17 closure contract persists a failed-payment flag before acknowledging or describing it to the owner', async () => {
  await using(async (world) => {
    const deferred = deferOperation(world.r2, 'put', rosterWriteWhere((saved) => saved.payment_failing === '2026-10-01'));
    const result = await invokeWhileDeferred(world, event('invoice.payment_failed', invoice({
      attempt_count: 2, next_payment_attempt: Date.parse('2026-10-02T00:15:00Z') / 1000,
    })), deferred, () => {
      assert.deepEqual(world.r2.json('subscribers.json'), [subscriber()]);
      assert.equal(world.mail.length, 0);
    });
    assert.equal(result.body.flagged, true);
    assert.equal(world.r2.json('subscribers.json')[0].payment_failing, '2026-10-01');
    assertOwnerOnly(world);
    const date = /Stripe retries on ([^<]+)\.<\/p>/.exec(world.mail[0].html);
    assert.ok(date, 'owner message contains an explicit next-retry date');
    assert.equal(date[1], '2026-10-02');
  });
});

test('I17 closure compatibility contract persists a resolved-risk flag before acknowledgment and owner notice', async () => {
  await using(async (world) => {
    const deferred = deferOperation(world.r2, 'put', rosterWriteWhere((saved) => saved.payment_failing === '2026-10-01'));
    const result = await invokeWhileDeferred(world, event('review.opened', {
      id: 'risk_TEST_delayed_flag', customer: CUSTOMER, customer_email: EMAIL,
    }), deferred, () => {
      // The deactivation write has completed; the distinct risk-detail write is held.
      assert.deepEqual(world.r2.json('subscribers.json'), [subscriber({ active: false, cancelled: '2026-10-01' })]);
      assert.equal(world.mail.length, 0);
    });
    assert.equal(result.body.stopped, 1);
    assert.equal(world.r2.json('subscribers.json')[0].payment_failing, '2026-10-01');
    assertOwnerOnly(world);
  });
});

for (const type of ['review.closed', 'invoice.payment_succeeded']) {
  test('I17 I18 closure contract awaits ID-only ' + type + ' recovery persistence', async () => {
    const before = subscriber({ payment_failing: '2026-09-29', payment_detail: { attempt: 2 } });
    await using(async (world) => {
      const deferred = deferOperation(world.r2, 'put', rosterWriteWhere((saved) => saved.payment_failing === undefined));
      const payload = type === 'review.closed'
        ? { id: 'prv_TEST_delayed_recovery', customer: CUSTOMER, closed_reason: 'approved' }
        : invoice({ customer_email: undefined, amount_paid: 9900, paid: true, status: 'paid' });
      const result = await invokeWhileDeferred(world, event(type, payload), deferred, () => {
        assert.deepEqual(world.r2.json('subscribers.json'), [before]);
        assert.equal(world.mail.length, 0);
      });
      assert.equal(result.body.ok, true);
      assert.deepEqual(world.r2.json('subscribers.json'), [subscriber()]);
      if (type === 'review.closed') {
        assertOwnerOnly(world);
        assert.ok(world.mail[0].subject.includes(CUSTOMER));
      } else assert.equal(world.mail.length, 0);
      // Starting active tests flag recovery without choosing automatic reactivation.
    }, { rows: [before] });
  });
}

test('I04 closure contract persists existing-row re-enrollment before the customer provider attempt', async () => {
  const before = subscriber({ active: false, cancelled: '2026-09-29' });
  await using(async (world) => {
    const deferred = deferOperation(world.r2, 'put', rosterWriteWhere((saved) => saved.active === true));
    const result = await invokeWhileDeferred(world, checkout(), deferred, () => {
      assert.deepEqual(world.r2.json('subscribers.json'), [before]);
      assert.equal(world.mail.length, 0);
    });
    assert.equal(result.body.ok, true);
    assert.deepEqual(world.r2.json('subscribers.json'), [subscriber()]);
    assert.equal(world.mail.length, 1);
    assert.ok(world.mail[0].html.includes('/api/my-leads?t=' + TOKEN + '&k=monthly'));
  }, { rows: [before] });
});

test('I16 closure contract acknowledges cancellation only after the changed roster is persisted', async () => {
  await using(async (world) => {
    const deferred = deferOperation(world.r2, 'put', rosterWriteWhere((saved) => saved.active === false));
    const result = await invokeWhileDeferred(world, event('customer.subscription.deleted', {
      id: 'sub_TEST_delayed_cancel', customer: CUSTOMER,
    }), deferred, () => {
      assert.deepEqual(world.r2.json('subscribers.json'), [subscriber()]);
      assert.equal(world.mail.length, 0);
    });
    assert.deepEqual(result.body, { ok: true, deactivated: 1 });
    assert.deepEqual(world.r2.json('subscribers.json'), [subscriber({ active: false, cancelled: '2026-10-01' })]);
    assert.equal(world.mail.length, 0);
  });
});

test('I04 I05 closure contract persists the referral lookup before emailing its customer link', async () => {
  await using(async (world) => {
    const deferred = deferOperation(world.r2, 'put', (key) => key.startsWith('referral/codes/'));
    const result = await invokeWhileDeferred(world, checkout(), deferred, ([key]) => {
      assert.equal(world.r2.text(key), null);
      assert.equal(world.mail.length, 0);
    });
    assert.equal(result.body.ok, true);
    assert.equal(world.mail.length, 1);
    const link = /href="https:\/\/masspermits\.com\/r\/([a-z0-9]{4,24})"/.exec(world.mail[0].html);
    assert.ok(link);
    assert.deepEqual(world.r2.json('referral/codes/' + link[1]), { email: EMAIL, ts: NOW });
  });
});

test('I05 closure contract persists referral attribution before the owner instruction and acknowledgment', async () => {
  await using(async (world) => {
    const referrer = 'casey+referrer@example.com';
    world.r2.set('referral/codes/testcode', { email: referrer, ts: NOW });
    const payload = checkout();
    payload.data.object.client_reference_id = 'ref-testcode';
    const deferred = deferOperation(world.r2, 'put', (key) => key.startsWith('referral/credits/'));
    const result = await invokeWhileDeferred(world, payload, deferred, ([key]) => {
      assert.equal(world.r2.text(key), null);
      assert.equal(world.mail.length, 1);
      assert.deepEqual(world.mail[0].to, [EMAIL]);
    });
    assert.equal(result.body.ok, true);
    const credits = world.r2.ops.filter((op) => op.op === 'put' && op.key.startsWith('referral/credits/'));
    assert.equal(credits.length, 1);
    assert.deepEqual(world.r2.json(credits[0].key), { code: 'testcode', referrer, buyer: EMAIL, ts: NOW });
    assert.equal(world.mail.length, 2);
    assert.deepEqual(world.mail[1].to, [OWNER]);
  });
});

test('I05 closure contract awaits the referral owner transport after attribution is stored', async () => {
  await using(async (world) => {
    world.r2.set('referral/codes/testcode', { email: 'casey+referrer@example.com', ts: NOW });
    const payload = checkout();
    payload.data.object.client_reference_id = 'ref-testcode';
    const deferred = deferOperation(globalThis, 'fetch', isOwnerTransport);
    const result = await invokeWhileDeferred(world, payload, deferred, () => {
      const credits = world.r2.ops.filter((op) => op.op === 'put' && op.key.startsWith('referral/credits/'));
      assert.equal(credits.length, 1);
      assert.equal(world.r2.json(credits[0].key).buyer, EMAIL);
      assert.equal(world.mail.length, 1);
      assert.deepEqual(world.mail[0].to, [EMAIL]);
    });
    assert.equal(result.body.ok, true);
    assert.equal(world.mail.length, 2);
    assert.deepEqual(world.mail[1].to, [OWNER]);
  });
});

test('I04 closure contract acknowledges a checkout with missing recipient without attempting delivery', async () => {
  await using(async (world) => {
    const payload = checkout();
    delete payload.data.object.customer_details;
    const result = await invoke(world, payload);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.delivered, undefined);
    assertNoEffects(world);
  });
});

test('I02 closure contract acknowledges a zero-value renewal without a known subscriber as a no-delivery result', async () => {
  await using(async (world) => {
    const result = await invoke(world, event('invoice.paid', invoice({
      amount_paid: 0, total: 0, amount_due: 0, paid: true, status: 'paid',
    })));
    assert.equal(result.response.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.skipped, 'invoice.paid');
    assert.equal(result.body.delivered, undefined);
    assert.equal(world.mail.length, 0);
    assert.deepEqual(world.r2.json('subscribers.json'), []);
    assert.equal(world.r2.ops.some((op) => op.op === 'get' && op.key === 'latest-weekly.zip'), false);
    // The roster read succeeded and was empty. This does not bless a storage
    // error being mislabeled as an unknown subscriber.
  }, { rows: [] });
});

test('I04 closure contract exposes a missing bundle as both HTTP and machine failure before mail', async () => {
  await using(async (world) => {
    world.r2.store.delete('latest-monthly.zip');
    const result = await invoke(world, checkout());
    assert.equal(result.response.status, 500);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.delivered, undefined);
    assert.deepEqual(world.r2.json('subscribers.json'), [subscriber()]);
    assert.equal(world.mail.length, 0);
  });
});

test('I04 closure contract exposes a bundle read exception as a machine failure without pinning raw error text', async () => {
  await using(async (world) => {
    world.r2.failNext('get', 'latest-monthly.zip');
    const result = await invoke(world, checkout());
    assert.equal(result.response.status, 500);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.delivered, undefined);
    assert.deepEqual(world.r2.json('subscribers.json'), [subscriber()]);
    assert.equal(world.mail.length, 0);
    // C19 still governs sanitization; the contents of error are not asserted.
  });
});

test('I16 closure contract reports zero changed rows when cancellation finds no roster object', async () => {
  await using(async (world) => {
    world.r2.store.delete('subscribers.json');
    const result = await invoke(world, event('customer.subscription.deleted', { id: 'sub_TEST_empty_roster', customer: CUSTOMER }));
    assert.equal(result.body.deactivated, 0);
    assert.equal(world.r2.text('subscribers.json'), null);
    assert.equal(world.mail.length, 0);
    // An absent object is distinct from a thrown read or malformed existing object.
  });
});

test('I17 closure contract reports no payment flag when the roster object is absent', async () => {
  await using(async (world) => {
    world.r2.store.delete('subscribers.json');
    const result = await invoke(world, event('invoice.payment_failed', invoice()));
    assert.equal(result.body.flagged, false);
    assert.equal(world.r2.text('subscribers.json'), null);
    assertOwnerOnly(world);
    assert.ok(world.mail[0].html.includes('NOT FOUND'));
  });
});

test('I02 I04 closure contract never treats an invoice address object as a recipient email', async () => {
  await using(async (world) => {
    const result = await invoke(world, event('invoice.paid', invoice({
      customer_email: null, customer_address: { city: 'town-a', country: 'US' },
      amount_paid: 9900, paid: true, status: 'paid',
    })));
    assert.equal(result.body.delivered, undefined);
    assert.equal(world.mail.length, 0);
    assert.equal(world.fetchCalls.length, 0);
    assert.equal(world.r2.ops.some((op) => op.op === 'get' && op.key === 'latest-weekly.zip'), false);
    assert.deepEqual(world.r2.json('subscribers.json'), [subscriber()]);
    // No customer_address.email compatibility field is invented, and no
    // assumption is made about how a provider would respond to an object recipient.
  });
});
