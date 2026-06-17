declare class Bitop {
  buffer: Buffer;
  buflen: number;
  bufpos: number;
  bufoff: number;
  iserro: boolean;
  constructor(buffer: Buffer);
  read(n: number): number;
}

export = Bitop;
