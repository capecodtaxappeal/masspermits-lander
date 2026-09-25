// MassPermits monday rehearsal: a read-only view of an R2 bucket.
//
// roBucket(bucket, opts) returns a PLAIN OBJECT (never a Proxy) with exactly
// five methods. get, head and list pass straight through. put and delete are
// RECORDED in .captured and NOT executed, unless opts.allowPrefix is set and
// the key starts with it. Either way they return a resolved Promise, because
// shipped handlers chain .catch() on put (leads.js logAccess).
//
// THE DEFAULT IS NO ALLOWED PREFIX. roBucket(bucket) drops every write,
// rehearsal/ included. Only the rehearsal's own code passes
// {allowPrefix: "rehearsal/"}; the shipped handlers it calls in-process always
// get the no-options view, so a handler can never persist anything.
//
// Any other R2 method (createMultipartUpload, resumeMultipartUpload, ...) does
// not exist on this object, so calling it throws before reaching the bucket.

export function roBucket(bucket, opts) {
  const allowPrefix =
    opts && typeof opts.allowPrefix === "string" && opts.allowPrefix.length > 0
      ? opts.allowPrefix
      : null;
  const captured = [];
  const allowed = (key) => allowPrefix !== null && typeof key === "string" &&
    key.startsWith(allowPrefix);

  const view = {
    get(key, options) { return bucket.get(key, options); },
    head(key) { return bucket.head(key); },
    list(options) { return bucket.list(options); },
    put(key, value, options) {
      const persisted = allowed(key);
      captured.push({ op: "put", key: String(key), persisted,
                      customMetadata: (options && options.customMetadata) || null });
      if (!persisted) return Promise.resolve(null);
      return Promise.resolve(bucket.put(key, value, options));
    },
    delete(key) {
      const keys = Array.isArray(key) ? key : [key];
      const persisted = keys.every(allowed);
      captured.push({ op: "delete", key: keys.map(String).join(","), persisted,
                      customMetadata: null });
      if (!persisted) return Promise.resolve(undefined);
      return Promise.resolve(bucket.delete(key));
    },
  };
  // Non-enumerable so the object's own enumerable methods stay exactly five.
  Object.defineProperty(view, "captured", { value: captured, enumerable: false });
  return Object.freeze(view);
}
