//  Created by Mingliang Chen on 17/8/1.
//  illuspas[a]gmail.com
//  Copyright (c) 2017 Nodemedia. All rights reserved.

import { EventEmitter } from 'events';

import { NodeHttpServer } from './node_http_server';
import { NodeRtmpServer } from './node_rtmp_server';
import { NodeRtmpSession } from './node_rtmp_session';
import { NodeFlvSession } from './node_flv_session';

export interface INodeMediaServerConfig {
  rtmp: {
    port: number;
    chunkSize: number;
    gopCache: boolean;
    ping: number;
  };
  http: {
    port: number | string;
    host: string | null;
  };
  api: {
    token: string | null;
  };
}

export type BaseSession = NodeRtmpSession & NodeFlvSession;

export class NodeMediaServer {
  private readonly config: INodeMediaServerConfig;

  public readonly sessions: Map<string, BaseSession>;
  private readonly publishers: Map<string, string>;
  private readonly idlePlayers: Set<string>;
  private readonly nodeEvent: EventEmitter;

  public nrs: NodeRtmpServer;
  public nhs: NodeHttpServer;

  constructor(config: INodeMediaServerConfig) {
    this.config = config;

    this.sessions = new Map();
    this.publishers = new Map();
    this.idlePlayers = new Set();
    this.nodeEvent = new EventEmitter();
  }

  run() {
    if (this.config.rtmp) {
      this.nrs = new NodeRtmpServer(
        this.config,
        this.sessions,
        this.publishers,
        this.idlePlayers,
        this.nodeEvent,
      );

      this.nrs.run();
    }

    if (this.config.http) {
      this.nhs = new NodeHttpServer(
        this.config,
        this.sessions,
        this.publishers,
        this.idlePlayers,
        this.nodeEvent,
      );

      this.nhs.run();
    }
  }

  on(eventName, listener) {
    this.nodeEvent.on(eventName, listener);
  }

  getSession(id: string) {
    return this.sessions.get(id);
  }
}
