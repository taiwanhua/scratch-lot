import { X509Certificate, generateKeyPairSync, sign } from "node:crypto";

/** 測試執行時現產的自簽憑證與它的私鑰(都是 PEM)。 */
export interface TestCertificate {
  certificatePem: string;
  privateKeyPem: string;
}

/** DER 的 TLV:tag + 長度(短式 / 長式)+ 內容。 */
function der(tag: number, ...contents: Buffer[]): Buffer {
  const body = Buffer.concat(contents);
  let length: Buffer;
  if (body.length < 0x80) {
    length = Buffer.from([body.length]);
  } else {
    const bytes: number[] = [];
    for (let rest = body.length; rest > 0; rest = Math.floor(rest / 256)) {
      bytes.unshift(rest % 256);
    }
    length = Buffer.from([0x80 + bytes.length, ...bytes]);
  }
  return Buffer.concat([Buffer.from([tag]), length, body]);
}

const SEQUENCE = 0x30;
const SET = 0x31;
const INTEGER = 0x02;
const BIT_STRING = 0x03;
const NULL = Buffer.from([0x05, 0x00]);
const UTF8_STRING = 0x0c;
const UTC_TIME = 0x17;
/** sha256WithRSAEncryption(1.2.840.113549.1.1.11)。 */
const SHA256_WITH_RSA = Buffer.from("06092a864886f70d01010b", "hex");
/** commonName(2.5.4.3)。 */
const COMMON_NAME = Buffer.from("0603550403", "hex");

function utcTime(date: Date): Buffer {
  const text = date.toISOString().replaceAll(/[-:T]/g, "").slice(2, 14);
  return der(UTC_TIME, Buffer.from(`${text}Z`, "ascii"));
}

function nameOf(commonName: string): Buffer {
  return der(
    SEQUENCE,
    der(
      SET,
      der(SEQUENCE, COMMON_NAME, der(UTF8_STRING, Buffer.from(commonName))),
    ),
  );
}

/**
 * 現產一張 X.509(v1)自簽憑證:Google `oauth2/v1/certs` 端點回的就是 `-----BEGIN CERTIFICATE-----` 格式。
 * 金鑰與憑證不入 repo(docs/agents/issue-tracker.md:測試用的金鑰 / 憑證由 harness 現產)。
 * Node 內建只能解析、不能簽發憑證,這裡以 DER 組出 TBSCertificate 再用 `crypto.sign` 簽,不為測試加依賴。
 */
export function createTestCertificate(): TestCertificate {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const algorithm = der(SEQUENCE, SHA256_WITH_RSA, NULL);
  const name = nameOf("scheduled-jobs-test-only");
  const now = Date.now();
  const tbs = der(
    SEQUENCE,
    der(INTEGER, Buffer.from([0x01])),
    algorithm,
    name,
    der(
      SEQUENCE,
      utcTime(new Date(now - 60_000)),
      utcTime(new Date(now + 24 * 60 * 60 * 1000)),
    ),
    name,
    publicKey.export({ type: "spki", format: "der" }),
  );
  const signature = sign("sha256", tbs, privateKey);
  const certificate = der(
    SEQUENCE,
    tbs,
    algorithm,
    der(BIT_STRING, Buffer.from([0x00]), signature),
  );
  // 用 Node 解析一次,確認組出來的是合法憑證
  const certificatePem = new X509Certificate(certificate).toString();
  return {
    certificatePem,
    privateKeyPem: privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
  };
}
