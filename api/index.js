const app = require('../src/server.js');

module.exports = async (req, res) => {
  try {
    return await app(req, res);
  } catch (err) {
    console.error('Serverless Function Error:', err);
    return res.status(500).json({
      error: 'Serverless Execution Error',
      message: err.message,
      stack: err.stack
    });
  }
};
