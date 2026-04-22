const crypto = require('crypto');

const requestContext = (req, res, next) => {
  const incomingId = req.headers['x-request-id'];
  const requestId = typeof incomingId === 'string' && incomingId.trim()
    ? incomingId.trim()
    : crypto.randomUUID();

  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
};

module.exports = { requestContext };
