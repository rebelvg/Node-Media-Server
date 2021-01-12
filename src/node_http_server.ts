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

export class NodeHttpServer {
  config: INodeMediaServerConfig;

  port: number | string;
  sessions: Map<string, BaseSession>;
  publishers: Map<string, string>;
  idlePlayers: Set<string>;

  expressApp: Express;
  httpServer: http.Server;
  wsServer: ws.Server;

  constructor(
    config: INodeMediaServerConfig,
    sessions: Map<string, BaseSession>,
    publishers: Map<string, string>,
    idlePlayers: Set<string>,
  ) {
    this.config = config;

    this.port = config.http.port;
    this.sessions = sessions;
    this.publishers = publishers;
    this.idlePlayers = idlePlayers;

    this.expressApp = express();

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

    this.httpServer = http.createServer(this.expressApp);
  }

  run() {
    this.httpServer.listen(this.port, () => {
      console.log(`Node Media Http Server started on port: ${this.port}`);
    });

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
      protocol,
    );

    this.sessions.set(id, session as BaseSession);

    session.run();
  }
}
