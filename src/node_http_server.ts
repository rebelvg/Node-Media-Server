//  Created by Mingliang Chen on 17/8/1.
//  illuspas[a]gmail.com
//  Copyright (c) 2017 Nodemedia. All rights reserved.

import * as http from 'http';
import * as ws from 'ws';
import * as express from 'express';
import { Express } from 'express';

import { generateNewSessionID } from './node_core_utils';
import { NodeFlvSession } from './node_flv_session';
import { BaseSession, INodeMediaServerConfig } from './node_media_server';
import { authCheck } from './api/middleware/auth';
import { getStreams } from './api/controllers/streams';

const HTTP_PORT = 80;

export class NodeHttpServer {
  config: INodeMediaServerConfig;

  port: number;
  sessions: Map<string, BaseSession>;
  publishers: Map<string, string>;
  idlePlayers: Set<string>;

  expressApp: Express;
  httpServer: http.Server;
  wsServer: ws.Server;

  constructor(config, sessions, publishers, idlePlayers) {
    this.config = config;

    this.port = config.http.port ? config.http.port : HTTP_PORT;
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
      req['nmsConnectionType'] = 'http';

      this.onConnect(req, res);
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

    this.wsServer.on('connection', (ws, req) => {
      req['nmsConnectionType'] = 'ws';

      this.onConnect(req, ws);
    });

    this.wsServer.on('listening', () => {
      console.log(`Node Media WebSocket Server started on port: ${this.port}`);
    });

    this.wsServer.on('error', (e) => {
      console.log(`Node Media WebSocket Server ${e}`);
    });
  }

  onConnect(req, res) {
    const id = generateNewSessionID();
    const session = new NodeFlvSession(this.config, req, res);

    this.sessions.set(id, session as BaseSession);
    session.id = id;
    session.sessions = this.sessions;
    session.publishers = this.publishers;
    session.idlePlayers = this.idlePlayers;
    session.run();
  }
}
