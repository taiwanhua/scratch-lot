#!/usr/bin/env node
/**
 * 把 read-config.mjs 的 JSON(stdin)映射成 GitHub Actions 的 step 輸出(附加到 `$GITHUB_OUTPUT`):
 *
 *   node scripts/project-settings/write-github-output.mjs --scope <cloud|github> < <讀取器輸出的檔案>
 *
 * 輸出鍵是本程式寫死的固定清單,輸入不能提供鍵名;值含控制字元(換行會變成另一行輸出)即拒絕。
 * 全部驗證通過才一次寫入,失敗時不寫任何內容。看板的 options 以單行 JSON 寫成一個輸出。
 * cloud 是停用狀態(`{"enabled":false}`)時明確失敗、不寫任何輸出:Deploy / Reset 因此在雲端認證前停止。
 */
import { appendFileSync, readFileSync } from "node:fs";

import {
  CLOUD_OUTPUT_KEYS,
  GITHUB_OUTPUT_KEYS,
  STATUS_OPTION_KEYS,
} from "./config.mjs";
import { singleLine } from "./single-line.mjs";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

const fail = (message) => {
  throw new Error(message);
};

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function exactKeys(value, keys, label) {
  if (!isPlainObject(value)) fail(`${label} 必須是物件`);
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key))
  ) {
    fail(`${label} 的鍵與固定清單不符`);
  }
}

function plainText(value, label) {
  if (
    typeof value !== "string" ||
    value === "" ||
    CONTROL_CHARACTERS.test(value)
  ) {
    fail(`${label} 必須是不含控制字元的非空字串`);
  }
  return value;
}

function cloudLines(config) {
  // 讀取器回報停用狀態:需要雲端的 workflow 在這裡停下,不寫任何輸出(後面的認證拿不到參數)
  if (
    isPlainObject(config) &&
    config.enabled === false &&
    Object.keys(config).length === 1
  ) {
    fail(
      "雲端尚未啟用(deploy/project/cloud.json 的 enabled 為 false):需要雲端的 workflow 不可執行,先完成雲端設定",
    );
  }
  exactKeys(config, CLOUD_OUTPUT_KEYS, "cloud 設定");
  return CLOUD_OUTPUT_KEYS.map((key) =>
    key === "resend_secret" && config[key] === ""
      ? "resend_secret="
      : `${key}=${plainText(config[key], key)}`,
  );
}

function githubLines(config) {
  if (!isPlainObject(config) || typeof config.enabled !== "boolean") {
    fail("github 設定的 enabled 必須是 true 或 false");
  }
  if (!config.enabled) {
    exactKeys(config, ["enabled"], "停用的 github 設定");
    return ["enabled=false"];
  }
  exactKeys(config, GITHUB_OUTPUT_KEYS, "github 設定");
  exactKeys(config.options, STATUS_OPTION_KEYS, "options");
  const options = Object.fromEntries(
    STATUS_OPTION_KEYS.map((key) => [
      key,
      plainText(config.options[key], `options.${key}`),
    ]),
  );
  return [
    "enabled=true",
    `project_id=${plainText(config.project_id, "project_id")}`,
    `status_field_id=${plainText(config.status_field_id, "status_field_id")}`,
    `options=${JSON.stringify(options)}`,
  ];
}

try {
  const argv = process.argv.slice(2);
  if (argv.length !== 2 || argv[0] !== "--scope") {
    fail("用法:write-github-output.mjs --scope <cloud|github>");
  }
  const builders = { cloud: cloudLines, github: githubLines };
  if (!Object.hasOwn(builders, argv[1])) {
    fail("--scope 必須是 cloud 或 github");
  }
  const target = process.env.GITHUB_OUTPUT;
  if (!target) fail("GITHUB_OUTPUT 未設定");

  let config;
  try {
    config = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    fail("stdin 不是合法的 JSON(讀取器失敗時不會有輸出)");
  }
  const lines = builders[argv[1]](config);
  appendFileSync(target, `${lines.join("\n")}\n`);
} catch (error) {
  process.stderr.write(`project-settings: ${singleLine(error.message)}\n`);
  process.exitCode = 1;
}
