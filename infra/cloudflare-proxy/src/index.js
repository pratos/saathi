const UPSTREAM_ORIGIN = "https://giant-caiman-748.convex.site";

export default {
  async fetch(request) {
    const incomingUrl = new URL(request.url);
    const upstreamUrl = new URL(
      `${incomingUrl.pathname}${incomingUrl.search}`,
      UPSTREAM_ORIGIN,
    );
    const response = await fetch(new Request(upstreamUrl, request));

    const location = response.headers.get("location");
    if (!location?.startsWith(UPSTREAM_ORIGIN)) return response;

    const headers = new Headers(response.headers);
    headers.set(
      "location",
      `${incomingUrl.origin}${location.slice(UPSTREAM_ORIGIN.length)}`,
    );
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
