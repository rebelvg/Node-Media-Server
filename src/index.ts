import { NodeMediaServer } from './node_media_server';

const config = {
  rtmp: {
    port: 1935,
    chunkSize: 60000,
    gopCache: true,
    ping: 60,
    host: 'localhost',
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

nms.on('preConnect', (id: string, args: any) => {
  console.log('preConnect', id, args);

  // const session = nms.getSession(id);
  // session.reject();
});

nms.on('postConnect', (id: string, args: any) => {
  console.log('postConnect', id, args);
});

nms.on('doneConnect', (id: string, args: any) => {
  console.log('doneConnect', id, args);
});

nms.on('prePublish', (id: string, streamPath: string, args: any) => {
  console.log('prePublish', id, streamPath, args);

  // const session = nms.getSession(id);
  // session.reject();
});

nms.on('postPublish', (id: string, streamPath: string, args: any) => {
  console.log('postPublish', id, streamPath, args);
});

nms.on('donePublish', (id: string, streamPath: string, args: any) => {
  console.log('donePublish', id, streamPath, args);
});

nms.on('prePlay', (id: string, streamPath: string, args: any) => {
  console.log('prePlay', id, streamPath, args);

  // const session = nms.getSession(id);
  // session.reject();
});

nms.on('postPlay', (id: string, streamPath: string, args: any) => {
  console.log('postPlay', id, streamPath, args);
});

nms.on('donePlay', (id: string, streamPath: string, args: any) => {
  console.log('donePlay', id, streamPath, args);
});

nms.run();
