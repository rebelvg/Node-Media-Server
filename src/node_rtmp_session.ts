//  Created by Mingliang Chen on 17/8/1.
//  illuspas[a]gmail.com
//  Copyright (c) 2017 Nodemedia. All rights reserved.

import { EventEmitter } from 'events';
import * as qs from 'querystring';
import * as net from 'net';

import { getProfileName, readAudioSpecificConfig } from './node_core_aac';
import {
  decodeAmf0Cmd,
  decodeAmf0Data,
  encodeAmf0Cmd,
  encodeAmf0Data,
} from './node_core_amf';
import { BufferPool } from './node_core_bufferpool';
import { NodeFlvSession } from './node_flv_session';
import { generateS0S1S2 } from './node_rtmp_handshake';
import { BaseSession, INodeMediaServerConfig } from './node_media_server';
import { SessionTypeEnum } from './node_base_session';

const EXTENDED_TIMESTAMP_TYPE_NOT_USED = 'not-used';
const EXTENDED_TIMESTAMP_TYPE_ABSOLUTE = 'absolute';
const EXTENDED_TIMESTAMP_TYPE_DELTA = 'delta';
const TIMESTAMP_ROUNDOFF = 4294967296;

const STREAM_BEGIN = 0x00;
const STREAM_EOF = 0x01;
const _STREAM_DRY = 0x02;
const _STREAM_EMPTY = 0x1f;
const STREAM_READY = 0x20;

const RTMP_CHUNK_SIZE = 128;
const RTMP_PING_TIME = 60000;
const _RTMP_PING_TIMEOUT = 30000;

const AUDIO_CODEC_NAME = [
  '',
  'ADPCM',
  'MP3',
  'LinearLE',
  'Nellymoser16',
  'Nellymoser8',
  'Nellymoser',
  'G711A',
  'G711U',
  '',
  'AAC',
  'Speex',
  '',
  '',
  'MP3-8K',
  'DeviceSpecific',
  'Uncompressed',
];
const VIDEO_CODEC_NAME = [
  '',
  'Jpeg',
  'Sorenson-H263',
  'ScreenVideo',
  'On2-VP6',
  'On2-VP6-Alpha',
  'ScreenVideo2',
  'H264',
  '',
  '',
  '',
  '',
  'H265',
];

export class NodeRtmpSession extends EventEmitter {
  protected readonly bp: BufferPool;
  public rtmpPlayers: Set<string>;
  public httpPlayers: Set<string>;
  private inChunkSize: number;
  private outChunkSize: number;
  private previousChunkMessage: any;
  private ping: number;
  private pingInterval: NodeJS.Timeout;
  public isActive = false;
  public isPublishing = false;
  public isPlaying = false;
  public isIdling = false;
  public isFirstAudioReceived = false;
  public isFirstVideoReceived = false;
  public metaData: any;
  public aacSequenceHeader: Buffer;
  public avcSequenceHeader: Buffer;
  public audioCodec: number;
  public audioCodecName: string;
  public audioProfileName: string;
  public audioSamplerate: number;
  public audioChannels: number;
  public videoCodec: number;
  public videoCodecName: string;
  public videoSize: string;
  public videoFps: number;
  private gopCacheEnable: boolean;
  public rtmpGopCacheQueue: Set<Buffer>;
  public flvGopCacheQueue: Set<Buffer>;
  private ackSize = 0;
  private inLastAck = 0;
  private appName: string;
  private streams = 0;
  private playStreamId = 0;
  public streamPath: string;
  public streamArgs: qs.ParsedUrlQuery;
  private publishStreamId = 0;
  private startTimestamp: number;
  private objectEncoding: number;
  public readonly connectTime = new Date();
  protected connectCmdObj: any;
  public sessionType = SessionTypeEnum.CONNECTED;
  protected sessionMetadata: any = {};

  constructor(
    public readonly id: string,
    config: INodeMediaServerConfig,
    private readonly socket: net.Socket,
    protected readonly sessions: Map<string, BaseSession>,
    protected readonly publishers: Map<string, string>,
    protected readonly idlePlayers: Set<string>,
    protected readonly nodeEvent: EventEmitter,
  ) {
    super();

    this.bp = new BufferPool();
    this.bp.on('error', (error) => {
      console.log('buffer_pool_error', error.message);
    });

    this.inChunkSize = RTMP_CHUNK_SIZE;
    this.outChunkSize = config.rtmp.chunkSize || RTMP_CHUNK_SIZE;
    this.previousChunkMessage = {};

    this.ping = config.rtmp.ping ? config.rtmp.ping * 1000 : RTMP_PING_TIME;

    this.gopCacheEnable = config.rtmp.gopCache;

    this.on('connect', this.onConnect);
    this.on('publish', this.onPublish);
    this.on('play', this.onPlay);
    this.on('closeStream', this.onCloseStream);
    this.on('deleteStream', this.onDeleteStream);

    this.socket.on('data', this.onSocketData.bind(this));
    this.socket.on('close', this.onSocketClose.bind(this));
    this.socket.on('error', this.onSocketError.bind(this));

    this.socket.setTimeout(20000);

    this.socket.on('timeout', () => {
      console.log('timeout', this.id);

      try {
        const socket = this.socket;

        this.stop();

        socket.destroy();
      } catch (e) {
        console.log(e);
      }
    });
  }

  public get stats() {
    return {
      bytesRead: this.socket.bytesRead,
      bytesWritten: this.socket.bytesWritten,
      remoteAddress: this.socket.remoteAddress,
    };
  }

  public addMetadata(data) {
    this.sessionMetadata = {
      ...this.sessionMetadata,
      ...data,
    };
  }

  public getMetadata() {
    return this.sessionMetadata;
  }

  public run() {
    this.isActive = true;
    this.bp.init(this.handleData());
  }

  public stop() {
    if (this.isActive) {
      this.isActive = false;
      this.bp.stop();
    }
  }

  public reject() {
    this.isActive = false;
  }

  private onSocketData(data) {
    this.bp.push(data);
  }

  private onSocketError(e) {
    this.stop();
  }

  private onSocketClose() {
    this.stop();
  }

  protected *handleData() {
    console.log('[rtmp handshake] start');
    if (this.bp.need(1537)) {
      if (yield) {
        return;
      }
    }
    const c0c1 = this.bp.read(1537);
    const s0s1s2 = generateS0S1S2(c0c1);

    this.socket.write(s0s1s2);

    if (this.bp.need(1536)) {
      if (yield) {
        return;
      }
    }

    const _c2 = this.bp.read(1536);

    console.log('[rtmp handshake] done');
    console.log('[rtmp message parser] start');

    this.bp.readBytes = 0;

    while (this.isActive) {
      const message: any = {};
      let chunkMessageHeader = null;
      let previousChunk = null;

      if (this.bp.need(1)) {
        if (yield) {
          break;
        }
      }

      const chunkBasicHeader = this.bp.read(1);

      message.formatType = chunkBasicHeader[0] >> 6;
      message.chunkStreamID = chunkBasicHeader[0] & 0x3f;
      if (message.chunkStreamID === 0) {
        // Chunk basic header 2 64-319
        if (this.bp.need(1)) {
          if (yield) {
            break;
          }
        }
        const exCSID = this.bp.read(1);

        message.chunkStreamID = exCSID[0] + 64;
      } else if (message.chunkStreamID === 1) {
        // Chunk basic header 3 64-65599
        if (this.bp.need(2)) {
          if (yield) {
            break;
          }
        }
        const exCSID = this.bp.read(2);

        message.chunkStreamID = (exCSID[1] << 8) + exCSID[0] + 64;
      } else {
        // Chunk basic header 1 2-63
      }

      previousChunk = this.previousChunkMessage[message.chunkStreamID];

      if (message.formatType === 0) {
        //Type 0 (11 bytes)
        if (this.bp.need(11)) {
          if (yield) {
            break;
          }
        }
        chunkMessageHeader = this.bp.read(11);
        message.timestamp = chunkMessageHeader.readUIntBE(0, 3);
        if (message.timestamp === 0xffffff) {
          message.extendedTimestampType = EXTENDED_TIMESTAMP_TYPE_ABSOLUTE;
        } else {
          message.extendedTimestampType = EXTENDED_TIMESTAMP_TYPE_NOT_USED;
        }
        message.timestampDelta = 0;
        message.messageLength = chunkMessageHeader.readUIntBE(3, 3);
        message.messageTypeID = chunkMessageHeader[6];
        message.messageStreamID = chunkMessageHeader.readUInt32LE(7);
        message.receivedLength = 0;
        message.chunks = [];
      } else if (message.formatType === 1) {
        //Type 1 (7 bytes)
        if (this.bp.need(7)) {
          if (yield) {
            break;
          }
        }
        chunkMessageHeader = this.bp.read(7);
        message.timestampDelta = chunkMessageHeader.readUIntBE(0, 3);
        if (message.timestampDelta === 0xffffff) {
          message.extendedTimestampType = EXTENDED_TIMESTAMP_TYPE_DELTA;
        } else {
          message.extendedTimestampType = EXTENDED_TIMESTAMP_TYPE_NOT_USED;
        }
        message.messageLength = chunkMessageHeader.readUIntBE(3, 3);
        message.messageTypeID = chunkMessageHeader[6];
        if (previousChunk) {
          message.timestamp = previousChunk.timestamp;
          message.messageStreamID = previousChunk.messageStreamID;
          message.receivedLength = previousChunk.receivedLength;
          message.chunks = previousChunk.chunks;
        } else {
          console.log(
            `Chunk reference error for type ${message.formatType}: previous chunk for id ${message.chunkStreamID} is not found`,
          );
          break;
        }
      } else if (message.formatType === 2) {
        // Type 2 (3 bytes)
        if (this.bp.need(3)) {
          if (yield) {
            break;
          }
        }
        chunkMessageHeader = this.bp.read(3);
        message.timestampDelta = chunkMessageHeader.readUIntBE(0, 3);
        if (message.timestampDelta === 0xffffff) {
          message.extendedTimestampType = EXTENDED_TIMESTAMP_TYPE_DELTA;
        } else {
          message.extendedTimestampType = EXTENDED_TIMESTAMP_TYPE_NOT_USED;
        }
        if (previousChunk) {
          message.timestamp = previousChunk.timestamp;
          message.messageStreamID = previousChunk.messageStreamID;
          message.messageLength = previousChunk.messageLength;
          message.messageTypeID = previousChunk.messageTypeID;
          message.receivedLength = previousChunk.receivedLength;
          message.chunks = previousChunk.chunks;
        } else {
          console.log(
            `Chunk reference error for type ${message.formatType}: previous chunk for id ${message.chunkStreamID} is not found`,
          );
          break;
        }
      } else if (message.formatType === 3) {
        // Type 3 (0 byte)
        if (previousChunk) {
          message.timestamp = previousChunk.timestamp;
          message.messageStreamID = previousChunk.messageStreamID;
          message.messageLength = previousChunk.messageLength;
          message.timestampDelta = previousChunk.timestampDelta;
          message.messageTypeID = previousChunk.messageTypeID;
          message.receivedLength = previousChunk.receivedLength;
          message.chunks = previousChunk.chunks;
        } else {
          console.log(
            `Chunk reference error for type ${message.formatType}: previous chunk for id ${message.chunkStreamID} is not found`,
          );
          break;
        }
      } else {
        console.log('Unknown format type: ' + message.formatType);
        break;
      }

      if (message.extendedTimestampType === EXTENDED_TIMESTAMP_TYPE_ABSOLUTE) {
        if (this.bp.need(4)) {
          if (yield) {
            break;
          }
        }
        const extTimestamp = this.bp.read(4);

        message.timestamp = extTimestamp.readUInt32BE();
      } else if (
        message.extendedTimestampType === EXTENDED_TIMESTAMP_TYPE_DELTA
      ) {
        const extTimestamp = this.bp.read(4);

        message.timestampDelta = extTimestamp.readUInt32BE();
      }

      let chunkBodySize = message.messageLength;

      chunkBodySize -= message.receivedLength;
      chunkBodySize = Math.min(chunkBodySize, this.inChunkSize);

      if (this.bp.need(chunkBodySize)) {
        if (yield) {
          break;
        }
      }
      const chunkBody = this.bp.read(chunkBodySize);

      message.receivedLength += chunkBodySize;
      message.chunks.push(chunkBody);
      if (message.receivedLength === message.messageLength) {
        if (message.timestampDelta) {
          message.timestamp += message.timestampDelta;
          if (message.timestamp > TIMESTAMP_ROUNDOFF) {
            message.timestamp %= TIMESTAMP_ROUNDOFF;
          }
        }

        const rtmpBody = Buffer.concat(message.chunks);

        this.handleRTMPMessage(message, rtmpBody);
        message.receivedLength = 0;
        message.chunks = [];
      }
      this.previousChunkMessage[message.chunkStreamID] = message;

      if (this.bp.readBytes >= 0xf0000000) {
        this.bp.readBytes = 0;
        this.inLastAck = 0;
      }
      if (
        this.ackSize > 0 &&
        this.bp.readBytes - this.inLastAck >= this.ackSize
      ) {
        this.inLastAck = this.bp.readBytes;
        this.sendACK(this.bp.readBytes);
      }
    }

    console.log('[rtmp message parser] done');

    this.onCloseStream(this.playStreamId);
    this.onCloseStream(this.publishStreamId);

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    this.nodeEvent.emit('doneConnect', this.id, this.connectCmdObj);
    this.socket.end();
    this.socket.removeAllListeners('data');
    this.socket.removeAllListeners('close');
    this.sessions.delete(this.id);
  }

  private createChunkBasicHeader(fmt, id) {
    let out;

    if (id >= 64 + 255) {
      out = Buffer.alloc(3);
      out[0] = (fmt << 6) | 1;
      out[1] = (id - 64) & 0xff;
      out[2] = ((id - 64) >> 8) & 0xff;
    } else if (id >= 64) {
      out = Buffer.alloc(2);
      out[0] = (fmt << 6) | 0;
      out[1] = (id - 64) & 0xff;
    } else {
      out = Buffer.alloc(1);
      out[0] = (fmt << 6) | id;
    }

    return out;
  }

  private createRtmpMessage(rtmpHeader, rtmpBody) {
    const chunkBasicHeader = this.createChunkBasicHeader(
      0,
      rtmpHeader.chunkStreamID,
    );
    const chunkMessageHeader = Buffer.alloc(11);
    let chunkExtendedTimestamp;
    let extendedTimestamp = 0;
    let useExtendedTimestamp = false;
    let rtmpBodySize = rtmpBody.length;
    let rtmpBodyPos = 0;
    const chunkBodys = [];

    rtmpHeader.messageLength = rtmpBody.length;

    if (rtmpHeader.timestamp >= 0xffffff) {
      useExtendedTimestamp = true;
      extendedTimestamp = rtmpHeader.timestamp;
      chunkExtendedTimestamp = Buffer.alloc(4);
      chunkExtendedTimestamp.writeUInt32BE(extendedTimestamp);
    }
    chunkMessageHeader.writeUIntBE(
      useExtendedTimestamp ? 0xffffff : rtmpHeader.timestamp,
      0,
      3,
    );
    chunkMessageHeader.writeUIntBE(rtmpHeader.messageLength, 3, 3);
    chunkMessageHeader.writeUInt8(rtmpHeader.messageTypeID, 6);
    chunkMessageHeader.writeUInt32LE(rtmpHeader.messageStreamID, 7);

    chunkBodys.push(chunkBasicHeader);
    chunkBodys.push(chunkMessageHeader);
    if (useExtendedTimestamp) {
      chunkBodys.push(chunkExtendedTimestamp);
    }
    do {
      if (rtmpBodySize > this.outChunkSize) {
        chunkBodys.push(
          rtmpBody.slice(rtmpBodyPos, rtmpBodyPos + this.outChunkSize),
        );
        rtmpBodySize -= this.outChunkSize;
        rtmpBodyPos += this.outChunkSize;
        chunkBodys.push(
          this.createChunkBasicHeader(3, rtmpHeader.chunkStreamID),
        );
        if (useExtendedTimestamp) {
          chunkBodys.push(chunkExtendedTimestamp);
        }
      } else {
        chunkBodys.push(
          rtmpBody.slice(rtmpBodyPos, rtmpBodyPos + rtmpBodySize),
        );
        rtmpBodySize -= rtmpBodySize;
        rtmpBodyPos += rtmpBodySize;
      }
    } while (rtmpBodySize > 0);

    return Buffer.concat(chunkBodys);
  }

  private handleRTMPMessage(rtmpHeader, rtmpBody) {
    // console.log(`[rtmp handleRtmpMessage] rtmpHeader.messageTypeID=${rtmpHeader.messageTypeID}`);
    switch (rtmpHeader.messageTypeID) {
      case 1:
        this.inChunkSize = rtmpBody.readUInt32BE();
        console.log(
          '[rtmp handleRtmpMessage] Set In chunkSize:' + this.inChunkSize,
        );
        break;
      case 3:
        // console.log('[rtmp handleRtmpMessage] Ack:' + rtmpBody.readUInt32BE());
        break;
      case 4:
        const userControlMessage: any = {};

        userControlMessage.eventType = rtmpBody.readUInt16BE();
        userControlMessage.eventData = rtmpBody.slice(2);
        this.handleUserControlMessage(userControlMessage);
        break;
      case 5:
        this.ackSize = rtmpBody.readUInt32BE();
        // console.log(`[rtmp handleRtmpMessage] WindowAck: ${this.ackSize}`);
        break;
      case 8:
        //Audio Data
        this.handleAudioMessage(rtmpHeader, rtmpBody);
        break;
      case 9:
        //Video Data
        this.handleVideoMessage(rtmpHeader, rtmpBody);
        break;
      case 15:
        //AMF3 DataMessage
        const amf3Data = decodeAmf0Data(rtmpBody.slice(1));

        this.handleAMFDataMessage(rtmpHeader.messageStreamID, amf3Data);
        break;
      case 17:
        //AMF3 CommandMessage
        const amf3Cmd = decodeAmf0Cmd(rtmpBody.slice(1));

        this.handleAMFCommandMessage(rtmpHeader.messageStreamID, amf3Cmd);
        break;
      case 18:
        //AMF0 DataMessage
        const amf0Data = decodeAmf0Data(rtmpBody);

        this.handleAMFDataMessage(rtmpHeader.messageStreamID, amf0Data);
        break;
      case 20:
        //AMF0 CommandMessage
        const amf0Cmd = decodeAmf0Cmd(rtmpBody);

        this.handleAMFCommandMessage(rtmpHeader.messageStreamID, amf0Cmd);
        break;
    }
  }

  private handleUserControlMessage(userControlMessage) {
    switch (userControlMessage.eventType) {
      case 3:
        const streamID = userControlMessage.eventData.readUInt32BE();
        const bufferLength = userControlMessage.eventData.readUInt32BE(4);

        console.log(
          `[rtmp handleUserControlMessage] SetBufferLength: streamID=${streamID} bufferLength=${bufferLength}`,
        );
        break;
      case 7:
        const _timestamp = userControlMessage.eventData.readUInt32BE();
        // console.log(`[rtmp handleUserControlMessage] PingResponse: timestamp=${timestamp}`);

        break;
    }
  }

  private handleAMFDataMessage(streamID, dataMessage) {
    // console.log('handleAMFDataMessage', dataMessage);
    switch (dataMessage.cmd) {
      case '@setDataFrame':
        if (dataMessage.dataObj) {
          const opt = {
            cmd: 'onMetaData',
            cmdObj: dataMessage.dataObj,
          };

          this.metaData = encodeAmf0Data(opt);
          this.audioSamplerate = dataMessage.dataObj.audiosamplerate;
          this.audioChannels = dataMessage.dataObj.stereo ? 2 : 1;
          this.videoSize =
            dataMessage.dataObj.width + 'x' + dataMessage.dataObj.height;
          this.videoFps = dataMessage.dataObj.framerate;
        }
        break;
      default:
        break;
    }
  }

  private handleAMFCommandMessage(streamID, commandMessage) {
    // console.log('handleAMFCommandMessage:', commandMessage);
    switch (commandMessage.cmd) {
      case 'connect':
        this.emit('connect', commandMessage.cmdObj);
        break;
      case 'createStream':
        this.respondCreateStream(commandMessage);
        break;
      case 'FCPublish':
        // this.respondFCPublish();
        break;
      case 'publish':
        this.streamPath =
          '/' + this.appName + '/' + commandMessage.streamName.split('?')[0];
        this.streamArgs = qs.parse(commandMessage.streamName.split('?')[1]);
        this.publishStreamId = streamID;
        // console.log('publish streamID=' + streamID);
        this.emit('publish');
        break;
      case 'play':
        this.streamPath =
          '/' + this.appName + '/' + commandMessage.streamName.split('?')[0];
        this.streamArgs = qs.parse(commandMessage.streamName.split('?')[1]);
        this.playStreamId = streamID;
        // console.log('play streamID=' + streamID);
        this.emit('play');
        break;
      case 'closeStream':
        this.emit('closeStream', streamID);
        break;
      case 'deleteStream':
        this.emit('deleteStream', streamID);
        break;
      case 'pause':
        // this.pauseOrUnpauseStream();
        break;
      case 'releaseStream':
        // this.respondReleaseStream();
        break;
      case 'FCUnpublish':
        // this.respondFCUnpublish();
        break;
      default:
        console.log(
          '[rtmp handleCommandMessage] unknown AMF command: ' +
            commandMessage.cmd,
        );
        break;
    }
  }

  private handleAudioMessage(rtmpHeader, rtmpBody) {
    if (!this.isPublishing) {
      return;
    }
    if (!this.isFirstAudioReceived) {
      let sound_format = rtmpBody[0];
      const sound_type = sound_format & 0x01;
      const sound_size = (sound_format >> 1) & 0x01;
      const sound_rate = (sound_format >> 2) & 0x03;

      sound_format = (sound_format >> 4) & 0x0f;
      this.audioCodec = sound_format;
      this.audioCodecName = AUDIO_CODEC_NAME[sound_format];
      console.log(
        `[rtmp handleAudioMessage] Parse AudioTagHeader sound_format=${sound_format} sound_type=${sound_type} sound_size=${sound_size} sound_rate=${sound_rate} codec_name=${this.audioCodecName}`,
      );

      if (sound_format === 10) {
        //cache aac sequence header
        if (rtmpBody[1] === 0) {
          this.aacSequenceHeader = Buffer.from(rtmpBody);
          this.isFirstAudioReceived = true;
          const info = readAudioSpecificConfig(this.aacSequenceHeader);

          this.audioProfileName = getProfileName(info);
          this.audioSamplerate = info.sample_rate;
          this.audioChannels = info.channels;
        }
      } else {
        this.isFirstAudioReceived = true;
      }
    }

    // console.log('Audio chunkStreamID='+rtmpHeader.chunkStreamID+' '+rtmpHeader.messageStreamID);
    // console.log(`Send Audio message timestamp=${rtmpHeader.timestamp} timestampDelta=${rtmpHeader.timestampDelta} bytesRead=${this.socket.bytesRead}`);

    const rtmpMessage = this.createRtmpMessage(rtmpHeader, rtmpBody);
    const flvMessage = NodeFlvSession.createFlvMessage(rtmpHeader, rtmpBody);

    if (this.rtmpGopCacheQueue) {
      if (this.aacSequenceHeader && rtmpBody[1] === 0) {
        //skip aac sequence header
      } else {
        this.rtmpGopCacheQueue.add(rtmpMessage);
        this.flvGopCacheQueue.add(flvMessage);
      }
    }

    for (const playerId of this.rtmpPlayers) {
      const session = this.sessions.get(playerId);

      if (session instanceof NodeRtmpSession) {
        rtmpMessage.writeUInt32LE(session.playStreamId, 8);
        session.socket.write(rtmpMessage);
      }
    }
    for (const playerId of this.httpPlayers) {
      const session = this.sessions.get(playerId);

      if (session instanceof NodeFlvSession) {
        session.write(flvMessage);
      }
    }
  }

  private handleVideoMessage(rtmpHeader, rtmpBody) {
    if (!this.isPublishing) {
      return;
    }
    let frame_type = rtmpBody[0];
    const codec_id = frame_type & 0x0f;

    frame_type = (frame_type >> 4) & 0x0f;

    if (!this.isFirstVideoReceived) {
      this.videoCodec = codec_id;
      this.videoCodecName = VIDEO_CODEC_NAME[codec_id];
      console.log(
        `[rtmp handleVideoMessage] Parse VideoTagHeader frame_type=${frame_type} codec_id=${codec_id} codec_name=${this.videoCodecName}`,
      );

      if (codec_id === 7 || codec_id === 12) {
        //cache avc sequence header
        if (frame_type === 1 && rtmpBody[1] === 0) {
          this.avcSequenceHeader = Buffer.from(rtmpBody);
          this.isFirstVideoReceived = true;
          this.rtmpGopCacheQueue = this.gopCacheEnable ? new Set() : null;
          this.flvGopCacheQueue = this.gopCacheEnable ? new Set() : null;
        }
      } else {
        this.isFirstVideoReceived = true;
      }
    }

    // console.log('Video chunkStreamID='+rtmpHeader.chunkStreamID+' '+rtmpHeader.messageStreamID);
    // console.log(`Send Video message timestamp=${rtmpHeader.timestamp} timestampDelta=${rtmpHeader.timestampDelta} `);

    const rtmpMessage = this.createRtmpMessage(rtmpHeader, rtmpBody);
    const flvMessage = NodeFlvSession.createFlvMessage(rtmpHeader, rtmpBody);

    if ((codec_id === 7 || codec_id === 12) && this.rtmpGopCacheQueue) {
      if (frame_type === 1 && rtmpBody[1] === 1) {
        this.rtmpGopCacheQueue.clear();
        this.flvGopCacheQueue.clear();
      }
      if (frame_type === 1 && rtmpBody[1] === 0) {
        // skip avc sequence header
      } else {
        this.rtmpGopCacheQueue.add(rtmpMessage);
        this.flvGopCacheQueue.add(flvMessage);
      }
    }

    for (const playerId of this.rtmpPlayers) {
      const session = this.sessions.get(playerId);

      if (session instanceof NodeRtmpSession) {
        rtmpMessage.writeUInt32LE(session.playStreamId, 8);
        session.socket.write(rtmpMessage);
      }
    }

    for (const playerId of this.httpPlayers) {
      const session = this.sessions.get(playerId);

      if (session instanceof NodeFlvSession) {
        session.write(flvMessage);
      }
    }
  }

  private sendACK(size) {
    const rtmpBuffer = Buffer.from('02000000000004030000000000000000', 'hex');

    rtmpBuffer.writeUInt32BE(size, 12);
    // console.log('windowACK: '+rtmpBuffer.hex());
    this.socket.write(rtmpBuffer);
  }

  private sendWindowACK(size) {
    const rtmpBuffer = Buffer.from('02000000000004050000000000000000', 'hex');

    rtmpBuffer.writeUInt32BE(size, 12);
    // console.log('windowACK: '+rtmpBuffer.hex());
    this.socket.write(rtmpBuffer);
  }

  private setPeerBandwidth(size, type) {
    const rtmpBuffer = Buffer.from('0200000000000506000000000000000000', 'hex');

    rtmpBuffer.writeUInt32BE(size, 12);
    rtmpBuffer[16] = type;
    // console.log('setPeerBandwidth: '+rtmpBuffer.hex());
    this.socket.write(rtmpBuffer);
  }

  private setChunkSize(size) {
    const rtmpBuffer = Buffer.from('02000000000004010000000000000000', 'hex');

    rtmpBuffer.writeUInt32BE(size, 12);
    // console.log('setChunkSize: '+rtmpBuffer.hex());
    this.socket.write(rtmpBuffer);
  }

  private sendStreamStatus(st, id) {
    const rtmpBuffer = Buffer.from(
      '020000000000060400000000000000000000',
      'hex',
    );

    rtmpBuffer.writeUInt16BE(st, 12);
    rtmpBuffer.writeUInt32BE(id, 14);
    this.socket.write(rtmpBuffer);
  }

  private sendRtmpSampleAccess() {
    const rtmpHeader = {
      chunkStreamID: 5,
      timestamp: 0,
      messageTypeID: 0x12,
      messageStreamID: 1,
    };

    const opt = {
      cmd: '|RtmpSampleAccess',
      bool1: false,
      bool2: false,
    };

    const rtmpBody = encodeAmf0Data(opt);
    const rtmpMessage = this.createRtmpMessage(rtmpHeader, rtmpBody);

    this.socket.write(rtmpMessage);
  }

  private sendStatusMessage(id, level, code, description) {
    const rtmpHeader = {
      chunkStreamID: 5,
      timestamp: 0,
      messageTypeID: 0x14,
      messageStreamID: id,
    };
    const opt = {
      cmd: 'onStatus',
      transId: 0,
      cmdObj: null,
      info: {
        level,
        code,
        description,
      },
    };
    const rtmpBody = encodeAmf0Cmd(opt);
    const rtmpMessage = this.createRtmpMessage(rtmpHeader, rtmpBody);

    this.socket.write(rtmpMessage);
  }

  private pingRequest() {
    const currentTimestamp = Date.now() - this.startTimestamp;
    const rtmpHeader = {
      chunkStreamID: 2,
      timestamp: currentTimestamp,
      messageTypeID: 0x4,
      messageStreamID: 0,
    };
    const rtmpBody = Buffer.from([
      0,
      6,
      (currentTimestamp >> 24) & 0xff,
      (currentTimestamp >> 16) & 0xff,
      (currentTimestamp >> 8) & 0xff,
      currentTimestamp & 0xff,
    ]);
    const rtmpMessage = this.createRtmpMessage(rtmpHeader, rtmpBody);

    this.socket.write(rtmpMessage);
    // console.log('pingRequest',rtmpMessage.toString('hex'));
  }

  private respondConnect() {
    const rtmpHeader = {
      chunkStreamID: 3,
      timestamp: 0,
      messageTypeID: 0x14,
      messageStreamID: 0,
    };
    const opt = {
      cmd: '_result',
      transId: 1,
      cmdObj: {
        fmsVer: 'FMS/3,0,1,123',
        capabilities: 31,
      },
      info: {
        level: 'status',
        code: 'NetConnection.Connect.Success',
        description: 'Connection succeeded.',
        objectEncoding: this.objectEncoding,
      },
    };
    const rtmpBody = encodeAmf0Cmd(opt);
    const rtmpMessage = this.createRtmpMessage(rtmpHeader, rtmpBody);

    this.socket.write(rtmpMessage);
  }

  private respondCreateStream(cmd) {
    this.streams++;
    const rtmpHeader = {
      chunkStreamID: 3,
      timestamp: 0,
      messageTypeID: 0x14,
      messageStreamID: 0,
    };
    const opt = {
      cmd: '_result',
      transId: cmd.transId,
      cmdObj: null,
      info: this.streams,
    };
    const rtmpBody = encodeAmf0Cmd(opt);
    const rtmpMessage = this.createRtmpMessage(rtmpHeader, rtmpBody);

    this.socket.write(rtmpMessage);
  }

  private respondPlay() {
    this.sendStreamStatus(STREAM_BEGIN, this.playStreamId);
    this.sendStatusMessage(
      this.playStreamId,
      'status',
      'NetStream.Play.Reset',
      'Playing and resetting stream.',
    );
    this.sendStatusMessage(
      this.playStreamId,
      'status',
      'NetStream.Play.Start',
      'Started playing stream.',
    );
    this.sendRtmpSampleAccess();
  }

  protected onConnect(cmdObj) {
    cmdObj.app = cmdObj.app.replace('/', '');

    this.nodeEvent.emit('preConnect', this.id, cmdObj);

    if (!this.isActive) {
      return;
    }

    this.sessionType = SessionTypeEnum.ACCEPTED;

    this.connectCmdObj = cmdObj;
    this.appName = cmdObj.app;
    this.objectEncoding = cmdObj.objectEncoding ? cmdObj.objectEncoding : 0;
    this.sendWindowACK(5000000);
    this.setPeerBandwidth(5000000, 2);
    this.setChunkSize(this.outChunkSize);
    this.respondConnect();
    this.startTimestamp = Date.now();
    this.pingInterval = setInterval(() => {
      this.pingRequest();
    }, this.ping);
    console.log('[rtmp connect] app: ' + cmdObj.app);
    this.nodeEvent.emit('postConnect', this.id, cmdObj);
  }

  protected onPublish() {
    this.nodeEvent.emit(
      'prePublish',
      this.id,
      this.streamPath,
      this.streamArgs,
    );

    if (!this.isActive) {
      return;
    }

    this.sessionType = SessionTypeEnum.PUBLISHER;

    if (this.publishers.has(this.streamPath)) {
      console.log(
        '[rtmp publish] Already has a stream path ' + this.streamPath,
      );
      this.sendStatusMessage(
        this.publishStreamId,
        'error',
        'NetStream.Publish.BadName',
        'Stream already publishing',
      );
    } else if (this.isPublishing) {
      console.log('[rtmp publish] NetConnection is publishing ');
      this.sendStatusMessage(
        this.publishStreamId,
        'error',
        'NetStream.Publish.BadConnection',
        'Connection already publishing',
      );
    } else {
      console.log(
        '[rtmp publish] new stream path ' +
          this.streamPath +
          ' streamId:' +
          this.publishStreamId,
      );
      this.publishers.set(this.streamPath, this.id);
      this.isPublishing = true;
      this.rtmpPlayers = new Set();
      this.httpPlayers = new Set();
      this.sendStatusMessage(
        this.publishStreamId,
        'status',
        'NetStream.Publish.Start',
        `${this.streamPath} is now published.`,
      );

      for (const idlePlayerId of this.idlePlayers) {
        const idlePlayer = this.sessions.get(idlePlayerId);

        if (idlePlayer.streamPath === this.streamPath) {
          idlePlayer.emit('play');
          this.idlePlayers.delete(idlePlayerId);
        }
      }

      this.nodeEvent.emit(
        'postPublish',
        this.id,
        this.streamPath,
        this.streamArgs,
      );
    }
  }

  protected onPlay() {
    this.nodeEvent.emit('prePlay', this.id, this.streamPath, this.streamArgs);

    if (!this.isActive) {
      return;
    }

    this.sessionType = SessionTypeEnum.SUBSCRIBER;

    if (this.isPlaying) {
      console.log('[rtmp play] NetConnection is playing');
      this.sendStatusMessage(
        this.playStreamId,
        'error',
        'NetStream.Play.BadConnection',
        'Connection already playing',
      );
    } else if (!this.publishers.has(this.streamPath)) {
      console.log(
        '[rtmp play] stream not found ' +
          this.streamPath +
          ' streamId:' +
          this.playStreamId,
      );
      this.respondPlay();
      // this.sendStreamEmpty();
      this.isIdling = true;
      this.idlePlayers.add(this.id);
    } else {
      if (this.isIdling) {
        this.sendStatusMessage(
          this.playStreamId,
          'status',
          'NetStream.Play.PublishNotify',
          `${this.streamPath} is now published.`,
        );
      } else {
        this.respondPlay();
      }
      const publisherPath = this.publishers.get(this.streamPath);
      const publisher = this.sessions.get(publisherPath);
      const rtmpPlayers = publisher.rtmpPlayers;

      this.isPlaying = true;
      //metaData
      if (publisher.metaData) {
        const rtmpHeader = {
          chunkStreamID: 5,
          timestamp: 0,
          messageTypeID: 0x12,
          messageStreamID: this.playStreamId,
        };

        const metaDataRtmpMessage = this.createRtmpMessage(
          rtmpHeader,
          publisher.metaData,
        );

        this.socket.write(metaDataRtmpMessage);
      }

      //send aacSequenceHeader
      if (publisher.audioCodec === 10) {
        const rtmpHeader = {
          chunkStreamID: 4,
          timestamp: 0,
          messageTypeID: 0x08,
          messageStreamID: this.playStreamId,
        };
        const rtmpMessage = this.createRtmpMessage(
          rtmpHeader,
          publisher.aacSequenceHeader,
        );

        this.socket.write(rtmpMessage);
      }
      //send avcSequenceHeader
      if (publisher.videoCodec === 7 || publisher.videoCodec === 12) {
        const rtmpHeader = {
          chunkStreamID: 6,
          timestamp: 0,
          messageTypeID: 0x09,
          messageStreamID: this.playStreamId,
        };
        const rtmpMessage = this.createRtmpMessage(
          rtmpHeader,
          publisher.avcSequenceHeader,
        );

        this.socket.write(rtmpMessage);
      }
      //send gop cache
      if (publisher.rtmpGopCacheQueue) {
        for (const rtmpMessage of publisher.rtmpGopCacheQueue) {
          rtmpMessage.writeUInt32LE(this.playStreamId, 8);
          this.socket.write(rtmpMessage);
        }
      }
      if (this.isIdling) {
        this.sendStreamStatus(STREAM_READY, this.playStreamId);
        this.isIdling = false;
      }

      console.log(
        '[rtmp play] join stream ' +
          this.streamPath +
          ' streamId:' +
          this.playStreamId,
      );
      rtmpPlayers.add(this.id);
      this.nodeEvent.emit(
        'postPlay',
        this.id,
        this.streamPath,
        this.streamArgs,
      );
    }
  }

  private onCloseStream(streamID, del = undefined) {
    if (this.isIdling && this.playStreamId === streamID) {
      this.sendStatusMessage(
        this.playStreamId,
        'status',
        'NetStream.Play.Stop',
        'Stopped playing stream.',
      );
      this.idlePlayers.delete(this.id);
      this.isIdling = false;
      this.playStreamId = del ? 0 : this.playStreamId;
    }

    if (this.isPlaying && this.playStreamId === streamID) {
      this.sendStatusMessage(
        this.playStreamId,
        'status',
        'NetStream.Play.Stop',
        'Stopped playing stream.',
      );
      const publisherPath = this.publishers.get(this.streamPath);

      if (publisherPath) {
        this.sessions.get(publisherPath).rtmpPlayers.delete(this.id);
      }
      this.isPlaying = false;
      this.playStreamId = del ? 0 : this.playStreamId;
      this.nodeEvent.emit(
        'donePlay',
        this.id,
        this.streamPath,
        this.streamArgs,
      );
    }

    if (this.isPublishing && this.publishStreamId === streamID) {
      this.sendStatusMessage(
        this.publishStreamId,
        'status',
        'NetStream.Unpublish.Success',
        `${this.streamPath} is now unpublished.`,
      );

      for (const playerId of this.rtmpPlayers) {
        const player = this.sessions.get(playerId);

        if (player instanceof NodeRtmpSession) {
          player.sendStatusMessage(
            player.playStreamId,
            'status',
            'NetStream.Play.UnpublishNotify',
            'stream is now unpublished.',
          );
        }
      }

      for (const playerId of this.httpPlayers) {
        const player = this.sessions.get(playerId);

        if (player instanceof NodeFlvSession) {
          player.stop();
        }
      }

      //let the players to idlePlayers
      for (const playerId of this.rtmpPlayers) {
        const player = this.sessions.get(playerId);

        this.idlePlayers.add(playerId);
        player.isPlaying = false;
        player.isIdling = true;

        if (player instanceof NodeRtmpSession) {
          player.sendStreamStatus(STREAM_EOF, player.playStreamId);
        }
      }

      for (const playerId of this.httpPlayers) {
        const player = this.sessions.get(playerId);

        this.idlePlayers.add(playerId);
        player.isPlaying = false;
        player.isIdling = true;
      }

      this.rtmpPlayers.clear();
      this.httpPlayers.clear();

      this.publishers.delete(this.streamPath);
      this.isPublishing = false;
      this.publishStreamId = del ? 0 : this.publishStreamId;
      this.nodeEvent.emit(
        'donePublish',
        this.id,
        this.streamPath,
        this.streamArgs,
      );
    }
  }

  private onDeleteStream(streamID) {
    this.onCloseStream(streamID, true);
  }
}
