// MassPermits manual intake Worker: the Email Routing entry point.
//
// Receives mail for the intake address on a SUBDOMAIN through Cloudflare
// Email Routing, parses it with postal-mime, and hands it to intake.js. It
// has no fetch handler, so it answers no web request at all. See
// docs/manual-inputs/SETUP.md for deployment and SECURITY.md for the rules.

import PostalMime from "postal-mime";
import { handleEmail } from "./intake.js";

export default {
  async email(message, env) {
    // handleEmail never throws and never replies, forwards or rejects.
    await handleEmail(message, env, { parse: (raw, opts) => PostalMime.parse(raw, opts) });
  },
};
