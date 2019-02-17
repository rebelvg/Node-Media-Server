# Node-Media-Server

[![npm](https://img.shields.io/npm/v/node-media-server.svg)](https://npmjs.org/package/node-media-server)
[![npm](https://img.shields.io/npm/dm/node-media-server.svg)](https://npmjs.org/package/node-media-server)
[![npm](https://img.shields.io/npm/l/node-media-server.svg)](LICENSE)

A Node.js implementation of RTMP/HTTP/WebSocket Media Server

# Features

- High performance RTMP parser based on ES6 Generator implementation
- Cross platform support Windows/Linux/Unix
- Support H.264/H.265/AAC/SPEEX/NELLYMOSER
- Support GOP cache
- Support remux to LIVE-HTTP-FLV,Support [flv.js](https://github.com/Bilibili/flv.js) playback
- Support remux to LIVE-WebSocket-FLV,Support [flv.js](https://github.com/Bilibili/flv.js) playback
- Support xycdn style authentication
- Support NetStream.Play and NetStream.Publish in one NetConnection
- Support event callback
- Support https/wss

# Usage

```bash
npm install node-media-server
```

```js
const NodeMediaServer = require('node-media-server');

const config = {
  rtmp: {
    port: 1935,
    chunk_size: 60000,
    gop_cache: true,
    ping: 60,
    ping_timeout: 30
  },
  http: {
    port: 8000,
    allow_origin: '*'
  },
  auth: {
    play: false,
    publish: false,
    secret: 'nodemedia2017privatekey'
  }
};

var nms = new NodeMediaServer(config);
nms.run();

nms.on('preConnect', (id, args) => {
  console.log('[NodeEvent on preConnect]', `id=${id} args=${JSON.stringify(args)}`);
  // let session = nms.getSession(id);
  // session.reject();
});

nms.on('postConnect', (id, args) => {
  console.log('[NodeEvent on postConnect]', `id=${id} args=${JSON.stringify(args)}`);
});

nms.on('doneConnect', (id, args) => {
  console.log('[NodeEvent on doneConnect]', `id=${id} args=${JSON.stringify(args)}`);
});

nms.on('prePublish', (id, StreamPath, args) => {
  console.log('[NodeEvent on prePublish]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
  // let session = nms.getSession(id);
  // session.reject();
});

nms.on('postPublish', (id, StreamPath, args) => {
  console.log('[NodeEvent on postPublish]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
});

nms.on('donePublish', (id, StreamPath, args) => {
  console.log('[NodeEvent on donePublish]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
});

nms.on('prePlay', (id, StreamPath, args) => {
  console.log('[NodeEvent on prePlay]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
  // let session = nms.getSession(id);
  // session.reject();
});

nms.on('postPlay', (id, StreamPath, args) => {
  console.log('[NodeEvent on postPlay]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
});

nms.on('donePlay', (id, StreamPath, args) => {
  console.log('[NodeEvent on donePlay]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
});
```

# Todo

- [ ] support record stream
- [ ] support transcode
- [ ] support cluster
- [ ] support low latency hls
- [ ] server and streams status
- [x] on_connect/on_publish/on_play/on_done event callback

# Publishing live streams

## From FFmpeg

> If you have a video file with H.264 video and AAC audio:

```bash
ffmpeg -re -i INPUT_FILE_NAME -c copy -f flv rtmp://localhost/live/STREAM_NAME
```

Or if you have a video file that is encoded in other audio/video format:

```bash
ffmpeg -re -i INPUT_FILE_NAME -c:v libx264 -preset superfast -tune zerolatency -c:a aac -ar 44100 -f flv rtmp://localhost/live/STREAM_NAME
```

## From OBS

> Settings -> Stream

Stream Type : Custom Streaming Server

URL : rtmp://localhost/live

Stream key : STREAM_NAME

# Accessing the live stream

## via RTMP

```bash
ffplay rtmp://localhost/live/STREAM_NAME
```

## via http-flv

```bash
ffplay http://localhost:8000/live/STREAM_NAME.flv
```

## via flv.js over http

```html
<script src="https://cdn.bootcss.com/flv.js/1.3.3/flv.min.js"></script>
<video id="videoElement"></video>
<script>
  if (flvjs.isSupported()) {
    var videoElement = document.getElementById('videoElement');
    var flvPlayer = flvjs.createPlayer({
      type: 'flv',
      url: 'http://localhost:8000/live/STREAM_NAME.flv'
    });
    flvPlayer.attachMediaElement(videoElement);
    flvPlayer.load();
    flvPlayer.play();
  }
</script>
```

## via flv.js over websocket

```html
<script src="https://cdn.bootcss.com/flv.js/1.3.3/flv.min.js"></script>
<video id="videoElement"></video>
<script>
  if (flvjs.isSupported()) {
    var videoElement = document.getElementById('videoElement');
    var flvPlayer = flvjs.createPlayer({
      type: 'flv',
      url: 'ws://localhost:8000/live/STREAM_NAME.flv'
    });
    flvPlayer.attachMediaElement(videoElement);
    flvPlayer.load();
    flvPlayer.play();
  }
</script>
```

# Authentication

## Encryption URL consists of:

> rtmp://hostname:port/appname/stream?sign=expires-HashValue  
> http://hostname:port/appname/stream.flv?sign=expires-HashValue  
> ws://hostname:port/appname/stream.flv?sign=expires-HashValue

1.Publish or play address:

> rtmp://192.168.0.10/live/stream

2.expiration time: 2017/8/23 11:25:21 ,The calculated expiration timestamp is

> 1503458721

3.Config set auth->secret: 'nodemedia2017privatekey'

```
const config = {
  rtmp: {
    port: 1935,
    chunk_size: 60000,
    gop_cache: true,
    ping: 60,
    ping_timeout: 30
  },
  http: {
    port: 8000,
    allow_origin: '*'
  },
  auth: {
    play: true,
    publish: true,
    secret: 'nodemedia2017privatekey'
  }
}
```

4.The combination HashValue is:

> HashValue = md5("/live/stream-1503458721-nodemedia2017privatekey”)  
> HashValue = 80c1d1ad2e0c2ab63eebb50eed64201a

5.Final request address

> rtmp://192.168.0.10/live/stream?sign=1503458721-80c1d1ad2e0c2ab63eebb50eed64201a  
> The 'sign' keyword can not be modified

# H.265 over RTMP

H.265 does not appear in Adobe's official specification. Id 12 is the standard for most cloud services in China.  
Publish or Transcode: [ffmpeg-hw-win32](#ffmpeg-hw-win32)  
Play:[NodeMediaClient-Android](#android) and [NodeMediaClient-iOS](#ios)

# Event callback

- preConnect
- postConnect
- prePublish
- postPublish
- donePublish
- prePlay
- postPlay
- donePlay

# Https/Wss

## Generate certificate

```
openssl genrsa -out privatekey.pem 1024
openssl req -new -key privatekey.pem -out certrequest.csr
openssl x509 -req -in certrequest.csr -signkey privatekey.pem -out certificate.pem
```

## Config https

```
const NodeMediaServer = require('./node_media_server');

const config = {
  rtmp: {
    port: 1935,
    chunk_size: 60000,
    gop_cache: true,
    ping: 60,
    ping_timeout: 30
  },
  http: {
    port: 8000,
    allow_origin: '*'
  },
  https: {
    port: 8443,
    key:'./privatekey.pem',
    cert:'./certificate.pem',
  },
  auth: {
    play: false,
    publish: false,
    secret: 'nodemedia2017privatekey'
  }
};


var nms = new NodeMediaServer(config)
nms.run();
```

## Accessing

```
https://localhost:8443/live/STREAM_NAME.flv
wss://localhost:8443/live/STREAM_NAME.flv
```

> hostname must be the same as the browser address

# Thanks

RTSP, RTMP, and HTTP server implementation in Node.js  
https://github.com/iizukanao/node-rtsp-rtmp-server

Node.JS module that provides an API for encoding and decoding of AMF0 and AMF3 protocols  
https://github.com/delian/node-amfutils

# Publisher and Player App/SDK

## Android Livestream App

https://play.google.com/store/apps/details?id=cn.nodemedia.qlive

http://www.nodemedia.cn/uploads/qlive-release.apk

## Android SDK

https://github.com/NodeMedia/NodeMediaClient-Android

## iOS SDK

https://github.com/NodeMedia/NodeMediaClient-iOS

## Flash Publisher

https://github.com/NodeMedia/NodeMediaClient-Web

## Raspberry pi Publisher

https://github.com/NodeMedia/NodeMediaDevice

## FFmpeg-hw-win32

https://github.com/illuspas/ffmpeg-hw-win32
