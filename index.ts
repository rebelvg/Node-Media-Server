import { NodeMediaServer } from './src/node_media_server';

const config = {
  rtmp: {
    port: 1935,
    chunkSize: 60000,
    gopCache: true,
    ping: 60,
  },
  http: {
    port: 8000,
    host: '127.0.0.1',
  },
  api: {
    token: null,
  },
};

const nms = new NodeMediaServer(config);

nms.on('preConnect', (id, args) => {
  console.log('preConnect', id, args);

  // const session = nms.getSession(id);
  // session.reject();
});

nms.on('postConnect', (id, args) => {
  console.log('postConnect', id, args);
});

nms.on('doneConnect', (id, args) => {
  console.log('doneConnect', id, args);
});

nms.on('prePublish', (id, streamPath, args) => {
  console.log('prePublish', id, streamPath, args);

  // const session = nms.getSession(id);
  // session.reject();
});

nms.on('postPublish', (id, streamPath, args) => {
  console.log('postPublish', id, streamPath, args);
});

nms.on('donePublish', (id, streamPath, args) => {
  console.log('donePublish', id, streamPath, args);
});

nms.on('prePlay', (id, streamPath, args) => {
  console.log('prePlay', id, streamPath, args);

  // const session = nms.getSession(id);
  // session.reject();
});

nms.on('postPlay', (id, streamPath, args) => {
  console.log('postPlay', id, streamPath, args);
});

nms.on('donePlay', (id, streamPath, args) => {
  console.log('donePlay', id, streamPath, args);
});

nms.run();
