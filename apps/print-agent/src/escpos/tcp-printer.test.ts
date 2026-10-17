import {
  type AddressInfo,
  type Server,
  type Socket,
  createServer,
} from "node:net";

import { afterEach, describe, expect, it } from "@jest/globals";

import { samplePrinter } from "../test-support/fakes";
import {
  FEED_AND_CUT,
  INITIALIZE,
  PAPER_STATUS_REQUEST,
  buildPrintCommands,
  concatChunks,
} from "./commands";
import { TcpPrinterTransport } from "./tcp-printer";

/**
 * 整合測試:測試內起一個**假的 9100 伺服器**(收據機),驗收到的位元組(底座規格第 6 章「代理程式」的測試)。
 * 假伺服器對 `DLE EOT 4` 回 `paperByte`(null = 不回應,模擬關掉即時狀態的機型)。
 */
interface FakePrinter {
  server: Server;
  port: number;
  received: () => Promise<Uint8Array>;
}

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
});

async function startFakePrinter(
  paperByte: number | null,
): Promise<FakePrinter> {
  const connections: Promise<Uint8Array>[] = [];
  const server = createServer((socket: Socket) => {
    connections.push(
      new Promise((resolve) => {
        const chunks: Buffer[] = [];
        let answered = false;
        socket.on("data", (data: Buffer) => {
          chunks.push(data);
          const all = Buffer.concat(chunks);
          if (
            !answered &&
            paperByte !== null &&
            all.includes(Buffer.from(PAPER_STATUS_REQUEST))
          ) {
            answered = true;
            socket.write(Uint8Array.of(paperByte));
          }
        });
        socket.on("end", () => {
          socket.end();
        });
        socket.on("close", () => {
          resolve(new Uint8Array(Buffer.concat(chunks)));
        });
      }),
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    server,
    port,
    received: async () => {
      for (let index = 0; index < 200 && connections.length === 0; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return connections[0] ?? Promise.resolve(new Uint8Array());
    },
  };
}

const bitmap = {
  width: 384,
  height: 200,
  bytesPerRow: 48,
  data: new Uint8Array(48 * 200).fill(0xaa),
};

describe("TCP 9100 送出(假印表機)", () => {
  it("先查紙、再送初始化 → 點陣圖各段 → 切紙;收到的位元組與產生的指令一致", async () => {
    const fake = await startFakePrinter(0x12);
    const transport = new TcpPrinterTransport({ statusTimeoutMs: 500 });
    const chunks = buildPrintCommands(bitmap);
    const outcome = await transport.print(
      samplePrinter({ port: fake.port }),
      chunks,
    );
    expect(outcome).toEqual({ ok: true });
    const received = await fake.received();
    const expected = concatChunks([PAPER_STATUS_REQUEST, ...chunks]);
    expect(Buffer.from(received).equals(Buffer.from(expected))).toBe(true);
    // 切紙指令在最後
    expect([...received.subarray(-FEED_AND_CUT.length)]).toEqual([
      ...FEED_AND_CUT,
    ]);
    expect([...received.subarray(3, 5)]).toEqual([...INITIALIZE]);
  });

  it("查紙沒有回應的機型照常列印", async () => {
    const fake = await startFakePrinter(null);
    const transport = new TcpPrinterTransport({ statusTimeoutMs: 100 });
    const outcome = await transport.print(
      samplePrinter({ port: fake.port }),
      buildPrintCommands(bitmap),
    );
    expect(outcome).toEqual({ ok: true });
    const received = await fake.received();
    expect([...received.subarray(-FEED_AND_CUT.length)]).toEqual([
      ...FEED_AND_CUT,
    ]);
  });

  it("缺紙:不送點陣圖,回報 paper-out", async () => {
    const fake = await startFakePrinter(0x72);
    const transport = new TcpPrinterTransport({ statusTimeoutMs: 500 });
    const outcome = await transport.print(
      samplePrinter({ port: fake.port }),
      buildPrintCommands(bitmap),
    );
    expect(outcome).toMatchObject({ ok: false, error: "paper-out" });
    const received = await fake.received();
    expect([...received]).toEqual([...PAPER_STATUS_REQUEST]);
  });

  it("連不上印表機 → printer-offline;狀態 = offline", async () => {
    const fake = await startFakePrinter(0x12);
    const { port } = fake;
    await new Promise<void>((resolve) => {
      fake.server.close(() => {
        resolve();
      });
    });
    servers.splice(servers.indexOf(fake.server), 1);
    const transport = new TcpPrinterTransport({ connectTimeoutMs: 500 });
    const printer = samplePrinter({ port });
    await expect(
      transport.print(printer, buildPrintCommands(bitmap)),
    ).resolves.toMatchObject({
      ok: false,
      error: "printer-offline",
    });
    await expect(transport.status(printer)).resolves.toBe("offline");
  });

  it("心跳查狀態:正常 ok、缺紙 paper-out", async () => {
    const transport = new TcpPrinterTransport({ statusTimeoutMs: 500 });
    const ok = await startFakePrinter(0x12);
    const out = await startFakePrinter(0x72);
    await expect(
      transport.status(samplePrinter({ port: ok.port })),
    ).resolves.toBe("ok");
    await expect(
      transport.status(samplePrinter({ port: out.port })),
    ).resolves.toBe("paper-out");
  });
});
