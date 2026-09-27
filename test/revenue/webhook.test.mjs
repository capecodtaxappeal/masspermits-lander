import test from 'node:test';
import assert from 'node:assert/strict';
import { loadHandlers, signedRequest, withWorld } from '../harness/index.mjs';

// Real exported handlers, synthetic data, closed provider transport.
// Attachment fixtures exercise byte transport only, not ZIP-format correctness.
// TODO cases execute desired assertions; they are not skipped or copied algorithms.
const handlers = await loadHandlers();
const NOW = '2026-09-28T14:00:00.000Z';
const SECONDS = Date.parse(NOW) / 1000;
const EMAIL = 'casey@example.com';
const SECOND = 'casey+second@example.com';
const OWNER = 'owner@example.com';
const CUSTOMER = 'cus_TEST_primary';
const TOKEN = '1'.repeat(32);
const MONTHLY = 'TEST monthly bundle bytes';
const WEEKLY = 'TEST weekly bundle bytes';
const MASS_PRICE = { id: 'price_TEST_weekly', product: 'prod_TEST_masspermits' };
const OTHER_PRICE = { id: 'price_TEST_other', product: 'prod_TEST_other' };

function row(overrides = {}) {
  return {
    email: EMAIL, name: 'TEST subscriber', customer: CUSTOMER,
    since: '2026-09-01', active: true, token: TOKEN, ...overrides,
  };
}
function event(type, object, { id = 'evt_TEST_primary', created = SECONDS - 30 } = {}) {
  return { id, object: 'event', type, created, livemode: false, data: { object } };
}
function checkout(overrides = {}, meta = {}) {
  return event('checkout.session.completed', {
    id: 'cs_TEST_primary', object: 'checkout.session', mode: 'subscription',
    amount_total: 9900, currency: 'usd', payment_status: 'paid',
    customer: CUSTOMER, subscription: 'sub_TEST_primary',
    customer_details: { email: EMAIL, name: 'TEST subscriber' },
    line_items: { object: 'list', data: [{ price: MASS_PRICE, quantity: 1 }] },
    ...overrides,
  }, meta);
}
function invoice(type = 'invoice.paid', overrides = {}, meta = {}) {
  return event(type, {
    id: 'in_TEST_primary', object: 'invoice', customer: CUSTOMER,
    customer_email: EMAIL, subscription: 'sub_TEST_primary',
    amount_paid: type === 'invoice.payment_failed' ? 0 : 9900,
    total: 9900, amount_due: 9900, currency: 'usd',
    status: type === 'invoice.payment_failed' ? 'open' : 'paid',
    paid: type !== 'invoice.payment_failed',
    billing_reason: 'subscription_cycle',
    lines: { object: 'list', data: [{ price: MASS_PRICE, quantity: 1 }] },
    ...overrides,
  }, meta);
}
function deletion(overrides = {}, meta = {}) {
  return event('customer.subscription.deleted', {
    id: 'sub_TEST_primary', object: 'subscription', customer: CUSTOMER,
    status: 'canceled', ended_at: SECONDS, current_period_end: SECONDS,
    items: { object: 'list', data: [{ price: MASS_PRICE }] }, ...overrides,
  }, meta);
}
function refund(overrides = {}, meta = {}) {
  return event('charge.refunded', {
    id: 'ch_TEST_primary', object: 'charge', customer: CUSTOMER,
    invoice: 'in_TEST_primary', payment_intent: 'pi_TEST_primary',
    amount: 9900, amount_refunded: 9900, refunded: true, currency: 'usd',
    ...overrides,
  }, meta);
}
async function using(fn, { rows = [], objects = {}, ...options } = {}) {
  return withWorld(async (world) => {
    world.env.OWNER_EMAIL = OWNER;
    world.env.FROM_EMAIL = 'TEST sender <sender@example.com>';
    world.r2.set('latest-monthly.zip', MONTHLY);
    world.r2.set('latest-weekly.zip', WEEKLY);
    world.r2.set('subscribers.json', rows);
    for (const [key, value] of Object.entries(objects)) world.r2.set(key, value);
    return fn(world);
  }, { now: NOW, ...options });
}
async function invoke(world, payload, signing = {}) {
  const request = signedRequest(payload, signing);
  const response = await world.call(handlers.webhook, '/api/stripe-webhook', {
    method: 'POST', headers: request.headers, body: await request.text(),
  });
  return { response, body: await response.json() };
}
async function roster(world) {
  return (await world.r2.json('subscribers.json')) || [];
}
function customerMail(world, email = EMAIL) {
  return world.mail.filter((mail) => (Array.isArray(mail.to) ? mail.to : [mail.to]).includes(email));
}
function ownerMail(world) {
  return world.mail.filter((mail) => (Array.isArray(mail.to) ? mail.to : [mail.to]).includes(OWNER));
}
function assertNoIdentity(value, forbidden = [EMAIL, CUSTOMER, TOKEN]) {
  const text = JSON.stringify(value);
  assert.deepEqual(forbidden.map((secret) => text.includes(secret)), forbidden.map(() => false),
    'machine response contains synthetic sensitive value');
}
function assertTextEscaped(html, tag = 'img') {
  assert.equal(html.includes('<' + tag), false, 'hostile element remained markup');
  assert.ok(html.includes('&lt;' + tag), 'hostile text was not represented as escaped text');
}

// Node test cases are sequential. Promise.all appears only inside deliberate race fixtures.
test('I01 invalid HMAC rejects before any storage or mail effect', { concurrency: false }, async () => {
  await using(async (world) => {
    const before = world.r2.ops.length;
    const result = await invoke(world, checkout(), { signature: 't=1,v1=' + '0'.repeat(64) });
    assert.equal(result.response.status, 400);
    assert.equal(result.body.error, 'bad signature');
    assert.equal(world.r2.ops.length, before);
    assert.equal(world.mail.length, 0);
  });
});

test('I01 tampered body with an otherwise valid signature has no side effects', async () => {
  await using(async (world) => {
    const payload = checkout();
    const request = signedRequest(payload);
    payload.data.object.amount_total = 500;
    const before = world.r2.ops.length;
    const response = await world.call(handlers.webhook, '/api/stripe-webhook', {
      method: 'POST', headers: request.headers, body: JSON.stringify(payload),
    });
    assert.equal(response.status, 400);
    assert.equal(world.r2.ops.length, before);
    assert.equal(world.mail.length, 0);
  });
});

test('I01 missing signing configuration rejects without side effects', async () => {
  await using(async (world) => {
    delete world.env.STRIPE_WEBHOOK_SECRET;
    const before = world.r2.ops.length;
    const result = await invoke(world, checkout());
    assert.equal(result.response.status, 400);
    assert.equal(world.r2.ops.length, before);
    assert.equal(world.mail.length, 0);
  });
});

test('I01 valid signature remains accepted when another v1 signature is present', async () => {
  await using(async (world) => {
    const request = signedRequest(checkout());
    request.headers.set('stripe-signature', request.headers.get('stripe-signature') + ',v1=' + '0'.repeat(64));
    const response = await world.call(handlers.webhook, '/api/stripe-webhook', {
      method: 'POST', headers: request.headers, body: await request.text(),
    });
    assert.equal(response.status, 200);
    assert.equal(customerMail(world).length, 1);
  });
});

for (const amount of [500, 990, 9900]) {
  test('I02 I04 subscription checkout at ' + amount + ' retains the promo floor and durable enrollment', async () => {
    await using(async (world) => {
      const result = await invoke(world, checkout({ amount_total: amount }));
      assert.equal(result.response.status, 200);
      assert.equal(result.body.ok, true);
      const saved = await roster(world);
      assert.equal(saved.length, 1);
      assert.equal(saved[0].customer, CUSTOMER);
      assert.equal(saved[0].active, true);
      assert.match(saved[0].token, /^[a-f0-9]{32}$/);
      const mail = customerMail(world);
      assert.equal(mail.length, 1);
      assert.equal(Buffer.from(mail[0].attachments[0].content, 'base64').toString(), MONTHLY);
      assert.ok(mail[0].html.includes('/api/my-leads?t=' + saved[0].token));
      const log = await world.r2.json('delivery-log.json');
      assert.equal(log.length, 1);
      assert.equal(log[0].to, EMAIL);
      assert.equal(log[0].kind, 'monthly');
    });
  });
}

for (const amount of [499, 435]) {
  test('I02 checkout at ' + amount + ' has no MassPermits delivery or entitlement', async () => {
    await using(async (world) => {
      const result = await invoke(world, checkout({ amount_total: amount }));
      assert.equal(result.response.status, 200);
      assert.equal(customerMail(world).length, 0);
      assert.deepEqual(await roster(world), []);
    });
  });
}

test('I02 one-time purchase receives monthly bytes without feed enrollment', async () => {
  await using(async (world) => {
    const result = await invoke(world, checkout({ mode: 'payment', subscription: null, amount_total: 4900 }));
    assert.equal(result.response.status, 200);
    assert.equal(customerMail(world).length, 1);
    assert.equal(Buffer.from(customerMail(world)[0].attachments[0].content, 'base64').toString(), MONTHLY);
    assert.deepEqual(await roster(world), []);
    assert.equal(customerMail(world)[0].html.includes('/api/my-leads?t='), false);
  });
});

test('I02 invoice.paid renewal sends weekly bytes and clears payment failure', async () => {
  await using(async (world) => {
    const result = await invoke(world, invoice());
    assert.equal(result.response.status, 200);
    assert.equal(customerMail(world).length, 1);
    assert.equal(Buffer.from(customerMail(world)[0].attachments[0].content, 'base64').toString(), WEEKLY);
    assert.equal((await roster(world))[0].payment_failing, undefined);
  }, { rows: [row({ payment_failing: '2026-09-27', payment_detail: { attempt: 1 } })] });
});

test('I02 initial subscription invoice does not duplicate checkout delivery', async () => {
  await using(async (world) => {
    await invoke(world, checkout());
    const result = await invoke(world, invoice('invoice.paid', { billing_reason: 'subscription_create' }, { id: 'evt_TEST_initial_invoice' }));
    assert.equal(result.response.status, 200);
    assert.equal(customerMail(world).length, 1);
  });
});

test('I02 435-cent renewal has no bundle delivery', async () => {
  await using(async (world) => {
    const result = await invoke(world, invoice('invoice.paid', { amount_paid: 435, total: 435 }));
    assert.equal(result.response.status, 200);
    assert.equal(customerMail(world).length, 0);
  }, { rows: [row()] });
});

for (const active of [true, undefined]) {
  test('I02 D2 zero-value renewal accepts known eligible row with active=' + String(active), async () => {
    const seeded = row();
    if (active === undefined) delete seeded.active;
    await using(async (world) => {
      const result = await invoke(world, invoice('invoice.paid', { amount_paid: 0, total: 0 }));
      assert.equal(result.response.status, 200);
      assert.equal(customerMail(world).length, 1);
      assert.equal(Object.hasOwn((await roster(world))[0], 'active'), active !== undefined);
    }, { rows: [seeded] });
  });
}

for (const rows of [[], [row({ active: false })]]) {
  test('I02 zero-value renewal does not mail ' + (rows.length ? 'an inactive' : 'an unknown') + ' subscriber', async () => {
    await using(async (world) => {
      const result = await invoke(world, invoice('invoice.paid', { amount_paid: 0, total: 0 }));
      assert.equal(result.response.status, 200);
      assert.equal(customerMail(world).length, 0);
    }, { rows });
  });
}

test('I03 C01 foreign-price zero-value trial cannot enroll a Weekly Feed subscriber',
  { todo: 'C01 product identity is not enforced before the zero-value trial exception' }, async () => {
    await using(async (world) => {
      await invoke(world, checkout({
        amount_total: 0, payment_status: 'no_payment_required',
        line_items: { object: 'list', data: [{ price: OTHER_PRICE, quantity: 1 }] },
      }));
      assert.equal(customerMail(world).length, 0);
      assert.deepEqual(await roster(world), []);
    });
  });

test('I03 C01 foreign product above the amount floor cannot receive the bundle',
  { todo: 'C01 amount-only routing does not identify a product' }, async () => {
    await using(async (world) => {
      await invoke(world, checkout({
        amount_total: 5220,
        line_items: { object: 'list', data: [{ price: OTHER_PRICE, quantity: 1 }] },
      }));
      assert.equal(customerMail(world).length, 0);
      assert.deepEqual(await roster(world), []);
    });
  });

test('I03 I16 C01 foreign subscription deletion cannot revoke the same customer Weekly Feed',
  { todo: 'C01 state handlers are not scoped to the entitled product or subscription' }, async () => {
    await using(async (world) => {
      await invoke(world, deletion({
        id: 'sub_TEST_other',
        items: { object: 'list', data: [{ price: OTHER_PRICE }] },
      }));
      assert.equal((await roster(world))[0].active, true);
    }, { rows: [row()] });
  });

test('I03 C01 foreign-product invoice cannot clear Weekly Feed payment failure',
  { todo: 'C01 payment state mutates before product classification' }, async () => {
    const before = row({ payment_failing: '2026-09-27', payment_detail: { attempt: 2 } });
    await using(async (world) => {
      await invoke(world, invoice('invoice.payment_succeeded', {
        subscription: 'sub_TEST_other', amount_paid: 435, total: 435,
        lines: { object: 'list', data: [{ price: OTHER_PRICE, quantity: 1 }] },
      }));
      assert.deepEqual(await roster(world), [before]);
    }, { rows: [before] });
  });

for (const operation of ['get', 'put']) {
  test('I04 C02 roster ' + operation + ' failure cannot be acknowledged as durable signup',
    { todo: 'C02 registration errors are swallowed before a successful delivery acknowledgment' }, async () => {
      await using(async (world) => {
        world.r2.failNext(operation, 'subscribers.json');
        const result = await invoke(world, checkout());
        const registered = (await roster(world)).some((entry) => entry.email === EMAIL && entry.active !== false);
        assert.ok(result.body.ok !== true || registered, 'complete success requires durable subscription membership');
      });
    });
}

for (const operation of ['get', 'put']) {
  test('I04 C02 delivery-log ' + operation + ' failure cannot claim complete recoverable delivery',
    { todo: 'C02 delivery evidence failure is swallowed after provider acceptance' }, async () => {
      await using(async (world) => {
        world.r2.failNext(operation, 'delivery-log.json');
        const result = await invoke(world, checkout());
        const log = (await world.r2.json('delivery-log.json')) || [];
        assert.ok(result.body.ok !== true || log.some((entry) => entry.to === EMAIL),
          'complete success requires durable first-delivery evidence or an explicit incomplete outcome');
      });
    });
}

test('I04 missing bundle read fails before enrollment or provider requests', async () => {
  await using(async (world) => {
    // Inject absence through the fake read; no object deletion API is needed.
    const get = world.r2.get.bind(world.r2);
    world.r2.get = async (key, ...args) => key === 'latest-monthly.zip' ? null : get(key, ...args);
    const result = await invoke(world, checkout());
    assert.equal(result.response.status, 500);
    assert.equal(world.mail.length, 0);
    assert.deepEqual(await roster(world), []);
  });
});

test('I04 rejected provider request returns failure and retry can complete once', async () => {
  await using(async (world) => {
    const payload = checkout();
    const first = await invoke(world, payload);
    const second = await invoke(world, payload);
    assert.equal(first.response.status, 500);
    assert.equal(second.response.status, 200);
    assert.equal(customerMail(world).length, 2, 'two requests, only the configured second request is accepted');
    assert.equal((await world.r2.json('delivery-log.json')).length, 1);
    assert.equal((await roster(world)).length, 1);
  }, { mailResponses: [{ status: 503, body: { message: 'TEST rejected before acceptance' } }, { status: 200, body: { id: 'mail_TEST_accepted' } }] });
});

test('I05 C03 duplicate accepted checkout event sends only one customer message',
  { todo: 'C03 no event deduplication or provider idempotency key' }, async () => {
    await using(async (world) => {
      const payload = checkout();
      await invoke(world, payload);
      await invoke(world, payload);
      assert.equal(customerMail(world).length, 1);
    });
  });

test('I05 C03 duplicate renewal event sends only one weekly message',
  { todo: 'C03 paid invoice event replay repeats the bundle' }, async () => {
    await using(async (world) => {
      const payload = invoice();
      await invoke(world, payload);
      await invoke(world, payload);
      assert.equal(customerMail(world).length, 1);
    }, { rows: [row()] });
  });

test('I05 C03 duplicate referral event credits and alerts only once',
  { todo: 'C03 repeated checkout repeats attribution writes and owner alerts' }, async () => {
    await using(async (world) => {
      world.r2.set('referral/codes/testcode', { email: SECOND, ts: NOW });
      const payload = checkout({ client_reference_id: 'ref-testcode' });
      await invoke(world, payload);
      await invoke(world, payload);
      assert.deepEqual({
        ownerAlerts: ownerMail(world).length,
        creditWrites: world.r2.ops.filter((op) => op.op === 'put' && op.key.startsWith('referral/credits/')).length,
      }, { ownerAlerts: 1, creditWrites: 1 });
    });
  });

test('I06 I18 replacement customer ID protects the original stale-ID cancellation case', async () => {
  await using(async (world) => {
    await invoke(world, checkout({ customer: 'cus_TEST_replacement', subscription: 'sub_TEST_replacement' }));
    await invoke(world, deletion({}, { id: 'evt_TEST_old_deletion' }));
    const saved = (await roster(world))[0];
    assert.equal(saved.customer, 'cus_TEST_replacement');
    assert.equal(saved.active, true);
    assert.equal(saved.token, TOKEN);
  }, { rows: [row()] });
});

test('I06 D2 checkout preserves absent active on an existing eligible legacy row', async () => {
  const legacy = row();
  delete legacy.active;
  await using(async (world) => {
    await invoke(world, checkout());
    assert.equal(Object.hasOwn((await roster(world))[0], 'active'), false);
    assert.equal((await roster(world))[0].token, TOKEN);
    assert.equal(customerMail(world).length, 1);
  }, { rows: [legacy] });
});

test('I06 C04 older checkout cannot replace a newer customer identity',
  { todo: 'C04 checkout uses arrival order rather than event chronology' }, async () => {
    await using(async (world) => {
      await invoke(world, checkout({ customer: 'cus_TEST_new', subscription: 'sub_TEST_new' },
        { id: 'evt_TEST_new_checkout', created: SECONDS - 10 }));
      await invoke(world, checkout({}, { id: 'evt_TEST_old_checkout', created: SECONDS - 100 }));
      assert.equal((await roster(world))[0].customer, 'cus_TEST_new');
    }, { rows: [row()] });
  });

test('I06 C04 deletion followed by older checkout remains revoked',
  { todo: 'C04 a delayed checkout can reactivate a newer cancellation' }, async () => {
    await using(async (world) => {
      await invoke(world, deletion({}, { id: 'evt_TEST_new_deletion', created: SECONDS - 10 }));
      await invoke(world, checkout({}, { id: 'evt_TEST_old_checkout', created: SECONDS - 100 }));
      assert.equal((await roster(world))[0].active, false);
    }, { rows: [row()] });
  });

test('I06 C04 older failed invoice cannot undo newer payment recovery',
  { todo: 'C04 payment flags lack event-time ordering' }, async () => {
    await using(async (world) => {
      await invoke(world, invoice('invoice.payment_succeeded', {}, { id: 'evt_TEST_recovery', created: SECONDS - 10 }));
      await invoke(world, invoice('invoice.payment_failed', { attempt_count: 1 }, { id: 'evt_TEST_old_failure', created: SECONDS - 100 }));
      assert.equal((await roster(world))[0].payment_failing, undefined);
    }, { rows: [row({ payment_failing: '2026-09-27', payment_detail: { attempt: 1 } })] });
  });

test('I06 C04 older payment recovery cannot clear newer failed invoice',
  { todo: 'C04 flag clearing also lacks event-time ordering' }, async () => {
    await using(async (world) => {
      await invoke(world, invoice('invoice.payment_failed', { attempt_count: 2 }, { id: 'evt_TEST_new_failure', created: SECONDS - 10 }));
      await invoke(world, invoice('invoice.payment_succeeded', {}, { id: 'evt_TEST_old_recovery', created: SECONDS - 100 }));
      assert.ok((await roster(world))[0].payment_failing);
    }, { rows: [row()] });
  });

// Both reads return immutable snapshots before either mutation continues.
function overlapTwoRosterReads(world) {
  const get = world.r2.get.bind(world.r2);
  let reads = 0;
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  world.r2.get = async (key, ...args) => {
    const snapshot = await get(key, ...args);
    if (key === 'subscribers.json' && reads < 2) {
      reads++;
      if (reads === 2) release();
      await barrier;
    }
    return snapshot;
  };
}

test('I07 C05 simultaneous independent checkouts preserve both subscribers',
  { todo: 'C05 whole-object roster writes race', timeout: 10000 }, async () => {
    await using(async (world) => {
      overlapTwoRosterReads(world);
      await Promise.all([
        invoke(world, checkout({}, { id: 'evt_TEST_first_checkout' })),
        invoke(world, checkout({
          id: 'cs_TEST_second', customer: 'cus_TEST_second', subscription: 'sub_TEST_second',
          customer_details: { email: SECOND, name: 'TEST second subscriber' },
        }, { id: 'evt_TEST_second_checkout' })),
      ]);
      assert.deepEqual((await roster(world)).map((entry) => entry.email).sort(), [EMAIL, SECOND].sort());
    });
  });

test('I07 C05 concurrent enrollment and cancellation preserve both valid changes',
  { todo: 'C05 enrollment and revocation replace the same roster object', timeout: 10000 }, async () => {
    await using(async (world) => {
      overlapTwoRosterReads(world);
      await Promise.all([
        invoke(world, checkout({
          id: 'cs_TEST_second', customer: 'cus_TEST_second', subscription: 'sub_TEST_second',
          customer_details: { email: SECOND, name: 'TEST second subscriber' },
        }, { id: 'evt_TEST_second_checkout' })),
        invoke(world, deletion({}, { id: 'evt_TEST_primary_cancel' })),
      ]);
      const saved = await roster(world);
      assert.ok(saved.some((entry) => entry.email === SECOND && entry.active === true));
      assert.equal(saved.find((entry) => entry.email === EMAIL)?.active, false);
    }, { rows: [row()] });
  });

test('I16 scheduled cancellation update preserves access before period end', async () => {
  await using(async (world) => {
    const result = await invoke(world, event('customer.subscription.updated', {
      id: 'sub_TEST_primary', object: 'subscription', customer: CUSTOMER,
      status: 'active', cancel_at_period_end: true, current_period_end: SECONDS + 86400,
      items: { object: 'list', data: [{ price: MASS_PRICE }] },
    }));
    assert.equal(result.response.status, 200);
    assert.equal((await roster(world))[0].active, true);
    assert.equal(world.mail.length, 0);
  }, { rows: [row()] });
});

test('I16 sole subscription deletion revokes eligibility and preserves token identity', async () => {
  await using(async (world) => {
    const result = await invoke(world, deletion());
    assert.equal(result.response.status, 200);
    assert.equal((await roster(world))[0].active, false);
    assert.equal((await roster(world))[0].token, TOKEN);
  }, { rows: [row()] });
});

test('I16 C13 deleting an older same-customer subscription preserves the newer paid subscription',
  { todo: 'C13 customer-level roster cannot represent multiple subscriptions' }, async () => {
    await using(async (world) => {
      await invoke(world, checkout({ subscription: 'sub_TEST_newer' }, { id: 'evt_TEST_newer_subscription' }));
      await invoke(world, deletion({ id: 'sub_TEST_older' }, { id: 'evt_TEST_older_subscription_deleted' }));
      assert.equal((await roster(world))[0].active, true);
    }, { rows: [row()] });
  });

test('I16 refund of another invoice does not revoke the current paid subscription', async () => {
  await using(async (world) => {
    await invoke(world, refund({ id: 'ch_TEST_other', invoice: 'in_TEST_other' }));
    assert.equal((await roster(world))[0].active, true);
  }, { rows: [row()] });
});

test('I16 C13 POLICY partial refund preserves paid-through access if that policy is selected',
  { todo: 'C13 owner policy pending; proposed partial-refund outcome, not a confirmed defect' }, async () => {
    await using(async (world) => {
      await invoke(world, refund({ amount_refunded: 100, refunded: false }));
      assert.equal((await roster(world))[0].active, true);
    }, { rows: [row()] });
  });

test('I16 C13 POLICY full sole-subscription refund revokes access if that policy is selected',
  { todo: 'C13 owner policy pending; proposed full-refund outcome, not an approved requirement' }, async () => {
    await using(async (world) => {
      await invoke(world, refund());
      assert.equal((await roster(world))[0].active, false);
    }, { rows: [row()] });
  });

test('I17 failed invoice flags the row without deactivation and later success clears it', async () => {
  await using(async (world) => {
    await invoke(world, invoice('invoice.payment_failed', {
      amount_paid: 0, attempt_count: 2, next_payment_attempt: SECONDS + 86400,
    }));
    let saved = (await roster(world))[0];
    assert.equal(saved.active, true);
    assert.ok(saved.payment_failing);
    assert.equal(saved.payment_detail.attempt, 2);
    assert.equal(customerMail(world).length, 0);
    assert.equal(ownerMail(world).length, 1);
    await invoke(world, invoice('invoice.payment_succeeded', {}, { id: 'evt_TEST_payment_recovered' }));
    saved = (await roster(world))[0];
    assert.equal(saved.active, true);
    assert.equal(saved.payment_failing, undefined);
    assert.equal(saved.payment_detail, undefined);
    assert.equal(customerMail(world).length, 0);
  }, { rows: [row()] });
});

test('I17 C14 nonzero renewal cannot deliver through an existing risk hold',
  { todo: 'C14 paid renewals do not enforce inactive or risk-held entitlement' }, async () => {
    await using(async (world) => {
      await invoke(world, invoice());
      assert.equal(customerMail(world).length, 0);
      assert.equal((await roster(world))[0].active, false);
    }, { rows: [row({ active: false, payment_failing: '2026-09-27', payment_detail: { radar: 'review.opened' } })] });
  });

for (const type of ['charge.dispute.created', 'radar.early_fraud_warning.created', 'review.opened']) {
  test('I17 C14 POLICY charge-only ' + type + ' has an explicit unresolved outcome if that response contract is selected',
    { todo: 'C14 response-contract policy pending; no resolved customer is supplied or inferred by this fixture' }, async () => {
      await using(async (world) => {
        const result = await invoke(world, event(type, {
          id: 'risk_TEST_primary', object: type === 'review.opened' ? 'review' : type.startsWith('charge.') ? 'dispute' : 'radar.early_fraud_warning',
          charge: 'ch_TEST_primary', payment_intent: 'pi_TEST_primary',
        }));
        // Do not guess which subscriber an unresolved charge belongs to. A 2xx
        // event acknowledgment is compatible with an explicit unresolved result;
        // rejecting the webhook and inducing retries is not the only valid policy.
        const explicitUnresolved = result.body.ok === false || result.body.unresolved === true ||
          result.body.status === 'unresolved' || result.body.held === false;
        assert.ok(explicitUnresolved, 'chosen contract requires an explicit unresolved hold outcome');
      }, { rows: [row()] });
    });
}

test('I17 C14 POLICY approved review restores held access if automatic recovery is selected',
  { todo: 'C14 owner policy pending; proposed approved-review outcome, not an approved requirement' }, async () => {
    await using(async (world) => {
      // An expanded related charge supplies identity; this does not claim default
      // webhook payloads normally include expanded charge objects.
      await invoke(world, event('review.closed', {
        id: 'prv_TEST_primary', object: 'review', closed_reason: 'approved',
        charge: { id: 'ch_TEST_primary', object: 'charge', customer: CUSTOMER,
          billing_details: { email: EMAIL } },
      }));
      assert.equal((await roster(world))[0].active, true);
    }, { rows: [row({ active: false, payment_failing: '2026-09-27', payment_detail: { radar: 'review.opened' } })] });
  });

for (const type of ['invoice.payment_failed', 'invoice.payment_succeeded']) {
  test('I18 C04 conflicting customer identity cannot ' + (type.endsWith('failed') ? 'replace' : 'clear') + ' current payment flags',
    { todo: 'C04 payment helpers use email OR customer without conflict precedence' }, async () => {
      const before = row({ payment_failing: '2026-09-26', payment_detail: { attempt: 7 } });
      await using(async (world) => {
        await invoke(world, invoice(type, { customer: 'cus_TEST_superseded', attempt_count: 1 }));
        assert.deepEqual(await roster(world), [before]);
      }, { rows: [before] });
    });
}

test('I24 C19 successful webhook machine response contains no recipient identity',
  { todo: 'C19 webhook response returns purchaser email' }, async () => {
    await using(async (world) => {
      const result = await invoke(world, checkout());
      assert.equal(result.response.status, 200);
      assertNoIdentity(result.body);
    });
  });

test('I24 C19 provider error response does not echo identity or bearer material',
  { todo: 'C19 provider response text is included in webhook error' }, async () => {
    await using(async (world) => {
      const result = await invoke(world, checkout());
      assert.equal(result.response.status, 500);
      assertNoIdentity(result.body);
    }, { mailResponses: [{ status: 429, body: { message: 'TEST provider detail ' + EMAIL + ' ' + TOKEN } }] });
  });

test('I26 purchase selection renders hostile synthetic text as text', async () => {
  await using(async (world) => {
    const result = await invoke(world, checkout({
      client_reference_id: 'town-a__<img src=x onerror="TEST()"> & synthetic',
    }));
    assert.equal(result.response.status, 200);
    const html = customerMail(world)[0].html;
    assertTextEscaped(html);
    assert.ok(html.includes('&quot;TEST()&quot;'));
    assert.ok(html.includes('&amp; synthetic'));
  });
});

test('I26 notice disclosure escapes hostile facts without mail or storage effects', async () => {
  await using(async (world) => {
    const before = world.r2.ops.length;
    const html = handlers.notice.disclosureBlock(['data_from_earlier_day'], {
      data_date: '<img src=x onerror="TEST()">',
    });
    assertTextEscaped(html);
    assert.equal(world.mail.length, 0);
    assert.equal(world.r2.ops.length, before);
  });
});

test('I26 no-delivery notice escapes synthetic name and ETA', async () => {
  await using(async (world) => {
    const notice = handlers.notice.nothingThisWeek({
      first_name: '<img src=x onerror="TEST()">', reason_code: 'no_bundle',
      eta: '<script>TEST()</script>',
    });
    assertTextEscaped(notice.html);
    assertTextEscaped(notice.html, 'script');
    assert.equal(world.mail.length, 0);
  });
});

test('I26 owner notice escapes verdict reasons and notes', async () => {
  await using(async (world) => {
    const notice = handlers.notice.ownerAlert({
      verdict: '<img src=x onerror="TEST()">', customer_gets_nothing: true,
      reasons: ['<script>TEST()</script>'], notes: ['<svg onload="TEST()">'],
    });
    assertTextEscaped(notice.html);
    assertTextEscaped(notice.html, 'script');
    assertTextEscaped(notice.html, 'svg');
    assert.equal(world.mail.length, 0);
  });
});
