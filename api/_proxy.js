const handler = require("../vercel-api-proxy");

module.exports = async function proxy(req, res) {
  const requestUrl = new URL(req.url || "/api/_proxy", "http://vercel.internal");
  const targetPath = requestUrl.searchParams.get("__path");

  if (!targetPath) {
    res.status(400).json({ error: "Missing API path" });
    return;
  }

  requestUrl.searchParams.delete("__path");
  const suffix = requestUrl.searchParams.toString();
  const forwardedReq = Object.create(req);
  forwardedReq.url = `/api/${targetPath}${suffix ? `?${suffix}` : ""}`;
  forwardedReq.once = req.once.bind(req);
  forwardedReq.off = req.off.bind(req);
  await handler(forwardedReq, res);
};
