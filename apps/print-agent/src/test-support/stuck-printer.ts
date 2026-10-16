import {
  type AddressInfo,
  type Server,
  type Socket,
  createServer,
} from "node:net";

import { PAPER_STATUS_REQUEST } from "../escpos/commands";

/**
 * 假的 9100 收據機:前 `stuckConnections` 條連線**接受但不讀資料**(卡紙、韌體當掉的樣子:
 * 不回 `DLE EOT`、socket 暫停讀取,對方寫到緩衝滿就卡住);之後的連線正常收資料、對 `DLE EOT 4` 回 0x12。
 */
export interface StuckPrinter {
  port: number;
  /** 已接受的連線數。 */
  connections(): number;
  /** 正常連線收到的位元組(依連線順序)。 */
  received: Uint8Array[];
  close(): Promise<void>;
}

export async function startStuckPrinter(
  stuckConnections: number,
): Promise<StuckPrinter> {
  const sockets: Socket[] = [];
  const received: Uint8Array[] = [];
  let accepted = 0;
  const server: Server = createServer((socket) => {
    sockets.push(socket);
    accepted += 1;
    socket.on("error", () => {
      // 對方 destroy 時的 ECONNRESET:測試不關心
    });
    if (accepted <= stuckConnections) {
      socket.pause();
      return;
    }
    const chunks: Buffer[] = [];
    let answered = false;
    socket.on("data", (data: Buffer) => {
      chunks.push(data);
      if (
        !answered &&
        Buffer.concat(chunks).includes(Buffer.from(PAPER_STATUS_REQUEST))
      ) {
        answered = true;
        socket.write(Uint8Array.of(0x12));
      }
    });
    socket.on("end", () => {
      received.push(new Uint8Array(Buffer.concat(chunks)));
      socket.end();
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    port,
    connections: () => accepted,
    received,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close(() => {
          resolve();
        });
      }),
  };
}

/** 等條件成立(真實時間;給 TCP 這種不受假計時器控制的東西用)。 */
export async function waitFor(
  condition: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("等待逾時");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
