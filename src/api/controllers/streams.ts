import * as _ from 'lodash';
import { SessionTypeEnum } from '../../node_base_session';

import { NodeFlvSession } from '../../node_flv_session';
import { NodeMediaServer } from '../../node_media_server';
import { NodeRtmpSession } from '../../node_rtmp_session';

export function getStreams(req, res, next) {
  const nms: NodeMediaServer = req['nms'];

  const stats = [];

  for (const [, session] of nms.sessions) {
    if (!session.isActive) {
      continue;
    }

    const regRes = /\/(.+)\/(.+)/gi.exec(session.streamPath);

    if (!regRes) {
      continue;
    }

    const [, app, channel] = regRes;

    let liveApp = _.find(stats, { app });

    if (!liveApp) {
      liveApp = {
        app,
        channels: [],
      };

      stats.push(liveApp);
    }

    let liveChannel = _.find(liveApp.channels, { channel });

    if (!liveChannel) {
      liveChannel = {
        channel,
        publisher: null,
        subscribers: [],
      };

      liveApp.channels.push(liveChannel);
    }

    if (session.sessionType === SessionTypeEnum.PUBLISHER) {
      liveChannel.publisher = {
        app,
        channel,
        connectId: session.id,
        connectCreated: session.connectTime,
        bytes: session.stats.bytesRead,
        ip: session.stats.remoteAddress,
        protocol: 'rtmp',
        video: {
          codecId: session.videoCodec,
          codecName: session.videoCodecName,
          size: session.videoSize,
          fps: session.videoFps,
        },
        audio: {
          codecId: session.audioCodec,
          codecName: session.audioCodecName,
          profile: session.audioProfileName,
          sampleRate: session.audioSamplerate,
          channels: session.audioChannels,
        },
        meta: session.getMetadata(),
      };
    }

    if (session.sessionType === SessionTypeEnum.SUBSCRIBER) {
      if (session instanceof NodeRtmpSession) {
        liveChannel.subscribers.push({
          app,
          channel,
          connectId: session.id,
          connectCreated: session.connectTime,
          bytes: session.stats.bytesWritten,
          ip: session.stats.remoteAddress,
          protocol: 'rtmp',
          meta: session.getMetadata(),
        });
      }

      if (session instanceof NodeFlvSession) {
        liveChannel.subscribers.push({
          app,
          channel,
          connectId: session.id,
          connectCreated: session.connectTime,
          bytes: session.stats.bytesWritten,
          ip: session.stats.remoteAddress,
          protocol: session.protocol,
          meta: session.getMetadata(),
        });
      }
    }
  }

  res.json({
    stats,
  });
}
