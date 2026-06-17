//  Created by Mingliang Chen on 17/8/1.
//  illuspas[a]gmail.com
//  Copyright (c) 2017 Nodemedia. All rights reserved.

import { Readable } from 'stream';

export class BufferPool extends Readable {
  readBytes!: number;
  poolBytes!: number;
  needBytes!: number;
  gFun!: Generator<void, void, boolean>;

  constructor(options = undefined) {
    super(options);
  }

  init(gFun: Generator<void, void, boolean>) {
    this.readBytes = 0;
    this.poolBytes = 0;
    this.needBytes = 0;
    this.gFun = gFun;
    this.gFun.next(false);
  }

  stop() {
    this.gFun.next(true);
  }

  push(buf: Buffer): any {
    if (this.destroyed) {
      return;
    }

    super.push(buf);
    this.poolBytes += buf.length;
    this.readBytes += buf.length;
    if (this.needBytes > 0 && this.needBytes <= this.poolBytes) {
      this.gFun.next(false);
    }
  }

  _read(): void {
    // empty
  }

  read(size: number) {
    const buf = super.read(size);

    if (buf) {
      this.poolBytes -= buf.length;
    }

    return buf;
  }

  need(size: number): boolean {
    const ret = this.poolBytes < size;

    if (ret) {
      this.needBytes = size;
    }

    return ret;
  }
}
