// middleware/ipBlock.js
const blockedIps = process.env.BLOCKED_IPS ? process.env.BLOCKED_IPS.split(',') : [];

module.exports = (req, res, next) => {
  const clientIp = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

  // Log the IP for debugging
  console.log(`[IP LOG] Request from: ${clientIp}`);

  // Block if IP is in the list
  if (blockedIps.includes(clientIp)) {
    console.log(`[IP BLOCK] Blocked IP: ${clientIp}`);
    return res.status(403).json({ error: 'Access denied' });
  }

  next();
};
