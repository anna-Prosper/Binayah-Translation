require('dotenv').config()

module.exports = async function (fastify) {

  // GET /jobs - list all active jobs status
  fastify.get('/jobs', async (request, reply) => {
    return { 
      status: 'ok',
      message: 'Jobs system ready',
      queue: 'bullmq'
    }
  })

}
