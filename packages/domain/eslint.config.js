import { config } from "@repo/eslint-config";

/**
 * 專案的共用純邏輯放 `src/project/<主題>/`(STRUCT-07、STRUCT-12):底座的主題不能 import 它,
 * 否則底座更新時會被專案內容卡住;專案主題可以 import 底座主題。
 */
export default [
  ...config,
  {
    files: ["src/**/*.ts"],
    ignores: ["src/project/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: String.raw`(^|/)project(/|$)`,
              message:
                "底座的 @repo/domain 主題不能 import 專案主題(src/project/);共用的規則放底座主題",
            },
          ],
        },
      ],
    },
  },
];
