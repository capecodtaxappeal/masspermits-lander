// Local access policy for signed billing events. No Stripe network lookup.
const KEY = "subscribers.json";
const id = value => typeof value === "string" ? value : value?.id || "";
const object = value => value && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const stamp = () => new Date().toISOString().slice(0, 10);

function policy(row) {
  const p = row.billing_access;
  if (p === undefined) return null;
  if (!object(p) || !object(p.refs) || !object(p.reviews) || !Array.isArray(p.blocks) ||
      !["charges", "payment_intents", "invoices"].every(key => Array.isArray(p.refs[key])))
    throw new Error("invalid billing policy");
  return p;
}
export function billingBlocked(row) {
  const p = policy(row);
  return !!p && (p.blocks.length > 0 || Object.values(p.reviews).some(r => r.state === "held"));
}
async function change(env, apply) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await env.BUNDLES.get(KEY);
    const text = current ? await current.text() : "[]";
    const rows = JSON.parse(text);
    if (!Array.isArray(rows) || rows.some(row => !object(row))) throw new Error("invalid roster");
    const result = apply(rows);
    const next = JSON.stringify(rows);
    if (next === JSON.stringify(JSON.parse(text))) return result;
    if (current && !current.etag) throw new Error("roster version unavailable");
    const saved = await env.BUNDLES.put(KEY, next, { onlyIf: current
      ? { etagMatches: current.etag } : { etagDoesNotMatch: "*" } });
    if (saved) return result;
  }
  throw new Error("billing policy contention");
}
function references(o, type) {
  return { charges: id(type === "charge.refunded" ? o.id : o.charge),
    payment_intents: id(o.payment_intent),
    invoices: id(type.startsWith("invoice.") ? o.id : o.invoice) };
}
function select(rows, event) {
  const o = event.data?.object || {}, refs = references(o, event.type), customer = id(o.customer);
  const matches = rows.filter(row => {
    const p = policy(row);
    if (!p || p.customer !== id(row.customer) || (customer && customer !== id(row.customer))) return false;
    return (event.type.startsWith("review.") && own(p.reviews, id(o.id))) ||
      Object.entries(refs).some(([key, ref]) => ref && p.refs[key].includes(ref));
  });
  if (matches.length !== 1) throw new Error("billing identity unresolved");
  return matches[0];
}
function block(row, key) {
  const p = policy(row);
  if (!p.blocks.includes(key)) p.blocks.push(key);
  row.active = false;
}

// Call only after the existing MassPermits delivery classifier and zero-price
// membership check. Cheap events from the shared account never reach this path.
export async function rememberBillingDelivery(env, event, email, { requireLinkedSubscription = false, requireRow = false } = {}) {
  const o = event.data?.object || {}, customer = id(o.customer), subscription = id(o.subscription);
  const checkout = event.type === "checkout.session.completed" && o.mode === "subscription";
  if (!customer || (!checkout && !event.type.startsWith("invoice."))) return true;
  return change(env, rows => {
    const matches = rows.filter(row => id(row.customer) === customer ||
      (checkout && String(row.email || "").toLowerCase() === String(email).toLowerCase()));
    if (!matches.length) {
      if (requireLinkedSubscription || requireRow) throw new Error("billing subscription unresolved");
      return true; // A new checkout is enrolled by the existing caller.
    }
    if (matches.length !== 1) throw new Error("billing identity ambiguous");
    const row = matches[0];
    let p = policy(row);
    if (requireLinkedSubscription && (!p || !subscription || p.subscription !== subscription))
      throw new Error("billing subscription unresolved");
    const newerIdentity = checkout && p && (p.customer !== customer ||
      (subscription && p.subscription && subscription !== p.subscription));
    if (newerIdentity && (!Number.isFinite(event.created) || event.created === (p.activated_at || 0)))
      throw new Error("billing order unresolved");
    if (newerIdentity && event.created < (p.activated_at || 0))
      return false; // A delayed old checkout cannot replace the known billing relationship.
    if (!checkout && p && (p.customer !== customer ||
        (subscription && p.subscription && subscription !== p.subscription)))
      throw new Error("billing subscription unresolved");
    if (!p || newerIdentity) {
      p = row.billing_access = { customer, subscription,
        refs: { charges: [], payment_intents: [], invoices: [] }, reviews: {}, blocks: [],
        activated_at: Number.isFinite(event.created) ? event.created : 0 };
      if (newerIdentity) { row.active = true; delete row.cancelled; }
    }
    if (checkout) {
      row.customer = customer;
      if (subscription) p.subscription = subscription;
    }
    for (const [key, ref] of Object.entries(references(o, event.type)))
      if (ref && !p.refs[key].includes(ref)) p.refs[key].push(ref);
    return !billingBlocked(row);
  });
}

export async function cancelBillingAccess(env, o) {
  return change(env, rows => {
    let changed = 0;
    for (const row of rows) {
      const p = policy(row);
      if (!p || p.customer !== id(row.customer) || p.customer !== id(o.customer) ||
          (p.subscription && id(o.id) !== p.subscription)) continue;
      block(row, "cancel:" + id(o.id));
      row.cancelled = stamp();
      changed++;
    }
    return changed;
  });
}

function result(row, kind) {
  return { policy: kind, active: row.active !== false,
    ownerDetail: { email: row.email || "", customer: row.customer || "" } };
}

export async function applyBillingAccess(env, event) {
  return change(env, rows => {
    const row = select(rows, event), p = policy(row), o = event.data.object;
    if (event.type === "charge.refunded") {
      if (!Number.isFinite(o.amount) || o.amount <= 0 || !Number.isFinite(o.amount_refunded) ||
          o.amount_refunded < 0 || o.amount_refunded > o.amount) throw new Error("invalid refund amounts");
      if (o.amount_refunded === o.amount) block(row, "refund:" + id(o.id));
      // A partial refund does not create a new end date or override another hold.
      return result(row, "refund");
    }
    if (event.type === "review.opened" || event.type === "review.closed") {
      const reviewId = id(o.id);
      if (!/^prv_[A-Za-z0-9_]+$/.test(reviewId)) throw new Error("review id unavailable");
      const prior = own(p.reviews, reviewId) ? p.reviews[reviewId] : null;
      if (event.type === "review.opened") {
        if (prior) return result(row, "review");
        if (!Object.values(p.reviews).some(r => r.state === "held"))
          p.resume = { present: own(row, "active"), active: row.active };
        p.reviews[reviewId] = { state: "held" };
        row.active = false;
      } else {
        const approved = o.closed_reason === "approved";
        p.reviews[reviewId] = { state: approved ? "approved" : "closed" };
        if (!approved) block(row, "review:" + reviewId);
        if (approved && prior?.state === "held" && !billingBlocked(row) && p.resume && !row.cancelled) {
          if (p.resume.present) row.active = p.resume.active;
          else delete row.active;
          delete p.resume;
        }
      }
      return result(row, "review");
    }
    block(row, event.type + ":" + id(o.id));
    return result(row, "fraud");
  });
}
