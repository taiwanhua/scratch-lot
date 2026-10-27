import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";

import { AppModule } from "./app.module";
import { applyTrustProxy } from "./http-proxy";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors({ origin: true, credentials: true });
  // Cloud Run 前面的代理層數:`req.ip` 才是客戶端 IP(見 `http-proxy.ts`)
  applyTrustProxy(app);
  // JSON body 上限:列印工作把 384 點寬的黑白 PNG 以 base64 放進 GraphQL(上限 512KB,
  // `@repo/domain/printing` 的 PRINT_IMAGE_MAX_BYTES),Express 預設的 100kb 不夠
  app.useBodyParser("json", { limit: "1mb" });

  const port = process.env.PORT ?? "5001";
  await app.listen(port);
  Logger.log(`api running on http://localhost:${port}/graphql`, "Bootstrap");
}

void bootstrap();
