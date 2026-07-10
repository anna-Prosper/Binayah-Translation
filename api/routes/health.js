const { WP, HEADERS } = require('../lib/wp-env');
const axios = require('axios');

module.exports = async function (fastify) {
  fastify.get('/health', async (req, reply) => {

    // Check WordPress
    let wordpress = false;
    try {
      const res = await axios.get(
        WP() + '/health',
        { timeout: 5000 }
      );
      wordpress = res.data && res.data.status === 'ok';
    } catch { wordpress = false; }

    // Check DeepSeek
    let deepseek = false;
    try {
      if (process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY !== 'your_deepseek_key_here') {
        const res = await axios.get('https://api.deepseek.com/v1/models', {
          headers: { Authorization: 'Bearer ' + process.env.DEEPSEEK_API_KEY },
          timeout: 5000,
        });
        deepseek = res.status === 200;
      }
    } catch { deepseek = false; }

    // Check OpenRouter
    let openrouter = false;
    try {
      if (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY !== 'your_openrouter_key_here') {
        const res = await axios.get('https://openrouter.ai/api/v1/models', {
          headers: { Authorization: 'Bearer ' + process.env.OPENROUTER_API_KEY },
          timeout: 5000,
        });
        openrouter = res.status === 200;
      }
    } catch { openrouter = false; }

    return { status: 'ok', commit: process.env.RENDER_GIT_COMMIT || 'dev', wordpress, deepseek, openrouter };
  });
};
