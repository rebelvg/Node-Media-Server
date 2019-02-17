const express = require('express');

const authCheck = require('../middleware/auth');

const { getStreams, getStream } = require('../controllers/streams');

const router = express.Router();

module.exports = nms => {
  router.use(authCheck.bind(nms));

  router.get('/', getStreams.bind(nms));
  router.get('/:app/:stream', getStream.bind(nms));

  return router;
};
