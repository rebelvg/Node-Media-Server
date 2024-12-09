//  Created by Mingliang Chen on 17/8/1.
//  illuspas[a]gmail.com
//  Copyright (c) 2017 Nodemedia. All rights reserved.

import { EventEmitter } from 'events';
import * as net from 'net';

import { generateNewSessionID } from './node_core_utils';
import { BaseSession, INodeMediaServerConfig } from './node_media_server';
import { NodeRtmpSession } from './node_rtmp_session';

export class NodeRtmpServer {
  private readonly port: number;
  private readonly host: string;
  private readonly tcpServer: net.Server;

  constructor(
    config: INodeMediaServerConfig,
    private readonly sessions: Map<string, BaseSession>,
    private readonly publishers: Map<string, string>,
    private readonly idlePlayers: Set<string>,
    private readonly nodeEvent: EventEmitter,
  ) {
    this.port = config.rtmp.port;
    this.host = config.rtmp.host;

    this.tcpServer = net.createServer((socket) => {
      const id = generateNewSessionID();

      const session = new NodeRtmpSession(
        id,
        config,
        socket,
        sessions,
        publishers,
        idlePlayers,
        nodeEvent,
      );

      sessions.set(id, session as BaseSession);

      session.run();
    });
  }

  run() {
    this.tcpServer.listen(this.port, this.host, () => {
      console.log(`Node Media Rtmp Server started on port: ${this.port}`);
    });

    this.tcpServer.on('error', (e) => {
      console.log(`Node Media Rtmp Server ${e}`);
    });
  }
}
