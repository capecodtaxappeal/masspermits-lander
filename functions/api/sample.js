// MassPermits — free-sample download (Pages Function).
// Serves the masked sample bundle from R2 so the lander's "free sample" is a
// real instant download (no manual send). The local weekly_refresh publishes
// latest-sample.zip to R2 alongside the paid bundles.
//
// Used by the lander: after the email-capture form succeeds, it links here.
// We still capture the email (via Web3Forms on the form) for follow-up; this
// endpoint just hands over the masked teaser instantly.

export async function onRequestGet(context) {
  const { env } = context;
  try {
    const file = await env.BUNDLES.get("latest-sample.zip");
    if (!file) return new Response("Sample not available yet — email hello@masspermits.com.", { status: 404 });
    return new Response(file.body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="MassPermits-FREE-SAMPLE.zip"`,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e) {
    return new Response("error: " + (e && e.message || e), { status: 500 });
  }
}
