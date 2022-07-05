//  Created by Mingliang Chen on 17/8/1.
//  illuspas[a]gmail.com
//  Copyright (c) 2017 Nodemedia. All rights reserved.

import * as http from 'http';
import * as ws from 'ws';
import * as express from 'express';
import { Express } from 'express';

import { generateNewSessionID } from './node_core_utils';
import { NodeFlvSession, ProtocolsEnum } from './node_flv_session';
import { BaseSession, INodeMediaServerConfig } from './node_media_server';
import { authCheck } from './api/middleware/auth';
import { getStreams } from './api/controllers/streams';
import { EventEmitter } from 'events';

export class NodeHttpServer {
  private readonly port: number | string;
  private readonly host: string;

  public readonly expressApp: Express;
  private httpServer: http.Server;
  private wsServer: ws.Server;

  constructor(
    config: INodeMediaServerConfig,
    private readonly sessions: Map<string, BaseSession>,
    private readonly publishers: Map<string, string>,
    private readonly idlePlayers: Set<string>,
    private readonly nodeEvent: EventEmitter,
  ) {
    this.port = config.http.port;
    this.host = config.http.host;

    this.expressApp = express();

    this.expressApp.set('trust proxy', true);

    this.expressApp.options('*.flv', (req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'range');

      res.end();
    });

    this.expressApp.get('*.flv', (req, res, next) => {
      this.onConnect(req, res, ProtocolsEnum.HTTP);
    });

    this.expressApp.use((req, res, next) => {
      req['nms'] = this;

      next();
    });

    this.expressApp.use(authCheck);

    this.expressApp.use('/api/streams', getStreams);

    this.expressApp.use((req, res, next) => {
      throw new Error('not_found');
    });

    this.expressApp.use((err, req, res, next) => {
      res.status(500).send(err.message);
    });
  }

  run() {
    this.httpServer = http.createServer(this.expressApp);

    if (this.host) {
      this.httpServer.listen(this.port as number, this.host, () => {
        console.log(
          `Node Media Http Server started on port: ${this.port} ${this.host}`,
        );
      });
    } else {
      this.httpServer.listen(this.port, () => {
        console.log(`Node Media Http Server started on port: ${this.port}`);
      });
    }

    this.httpServer.on('error', (e) => {
      console.log(`Node Media Http Server ${e}`);
    });

    this.wsServer = new ws.Server({ server: this.httpServer });

    this.wsServer.on('connection', (ws: http.ServerResponse, req) => {
      this.onConnect(req, ws, ProtocolsEnum.WS);
    });

    this.wsServer.on('listening', () => {
      console.log(`Node Media WebSocket Server started on port: ${this.port}`);
    });

    this.wsServer.on('error', (e) => {
      console.log(`Node Media WebSocket Server ${e}`);
    });
  }

  onConnect(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    protocol: ProtocolsEnum,
  ) {
    const id = generateNewSessionID();

    const session = new NodeFlvSession(
      id,
      req,
      res,
      this.sessions,
      this.publishers,
      this.idlePlayers,
      this.nodeEvent,
      protocol,
    );

    this.sessions.set(id, session as BaseSession);

    session.run();
  }
}
