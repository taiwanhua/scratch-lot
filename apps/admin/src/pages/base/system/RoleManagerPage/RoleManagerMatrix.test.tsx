import { describe, expect, it } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";
import { delay } from "msw";

import { api, server } from "@/test/msw/server";

import {
  matrixCheckbox,
  matrixRow,
  renderRolePage,
} from "./role-manager-test-support";

const SAMPLE_ONE = "demo.sub.sample-one";

/** 夾具的預設授予:進得去示範模組1、只給了「檢視」。 */
const openMatrix = async () => {
  const rendered = renderRolePage();
  await screen.findByText("內容編輯 — 權限設定");
  // 矩陣是第二個查詢,樹還沒到手前 `Tree` 顯示骨架列
  await screen.findByText("示範模組1");
  return rendered;
};

const save = async (actor: { click: (element: Element) => Promise<void> }) => {
  await actor.click(screen.getByRole("button", { name: "儲存變更" }));
};

describe("角色管理:權限矩陣頁籤", () => {
  it("初始狀態:有子孫被勾的上層是勾選且不可取消,部分勾選的模組標 mixed", async () => {
    await openMatrix();

    expect(matrixCheckbox("示範群組demo")).toBeDisabled();
    expect(matrixCheckbox("示範次群組demo.sub")).toBeDisabled();
    // 自己這層只勾了一筆權限 → 三態
    expect(matrixRow(`示範模組1${SAMPLE_ONE}`)).toHaveAttribute(
      "aria-checked",
      "mixed",
    );
    expect(matrixCheckbox(`檢視${SAMPLE_ONE}.view`)).toBeChecked();
    expect(matrixCheckbox(`新增${SAMPLE_ONE}.create`)).not.toBeChecked();
  });

  it("勾下一筆權限 → 存起來的是個別筆(模組由 normalizeGrant 補上)", async () => {
    const { user: actor, fake } = await openMatrix();

    await actor.click(matrixCheckbox(`新增${SAMPLE_ONE}.create`));
    expect(matrixCheckbox(`新增${SAMPLE_ONE}.create`)).toBeChecked();

    await save(actor);
    await waitFor(() => {
      expect(fake.inputs.saveRoleMatrix.at(-1)).toEqual({
        roleId: "role-editor",
        moduleKeys: ["demo", "demo.sub", SAMPLE_ONE],
        permissionKeys: [`${SAMPLE_ONE}.view`, `${SAMPLE_ONE}.create`],
      });
    });
  });

  it("勾「全部(*)」同層全帶入,只存一筆 `*`", async () => {
    const { user: actor, fake } = await openMatrix();

    await actor.click(matrixCheckbox(`全部(*)${SAMPLE_ONE}.*`));

    expect(matrixCheckbox(`檢視${SAMPLE_ONE}.view`)).toBeChecked();
    expect(matrixCheckbox(`新增${SAMPLE_ONE}.create`)).toBeChecked();
    expect(matrixCheckbox(`編輯${SAMPLE_ONE}.edit`)).toBeChecked();

    await save(actor);
    await waitFor(() => {
      expect(fake.inputs.saveRoleMatrix.at(-1)?.permissionKeys).toEqual([
        `${SAMPLE_ONE}.*`,
      ]);
    });
  });

  it("勾了 `*` 之後取消同層任一筆 → `*` 解除,其餘改存個別筆", async () => {
    const { user: actor, fake } = await openMatrix();

    await actor.click(matrixCheckbox(`全部(*)${SAMPLE_ONE}.*`));
    await actor.click(matrixCheckbox(`檢視${SAMPLE_ONE}.view`));

    expect(matrixCheckbox(`全部(*)${SAMPLE_ONE}.*`)).not.toBeChecked();
    expect(matrixCheckbox(`檢視${SAMPLE_ONE}.view`)).not.toBeChecked();
    expect(matrixCheckbox(`新增${SAMPLE_ONE}.create`)).toBeChecked();

    await save(actor);
    await waitFor(() => {
      expect(fake.inputs.saveRoleMatrix.at(-1)?.permissionKeys).toEqual([
        `${SAMPLE_ONE}.create`,
        `${SAMPLE_ONE}.edit`,
      ]);
    });
  });

  it("全選整組 / 清空整組:子樹每個模組各存一筆 `*`,清空後整棵不留", async () => {
    const { user: actor, fake } = await openMatrix();

    await actor.click(screen.getByRole("button", { name: "全選整組" }));
    await save(actor);
    await waitFor(() => {
      expect(fake.inputs.saveRoleMatrix.at(-1)).toEqual({
        roleId: "role-editor",
        moduleKeys: ["demo", "demo.sub", SAMPLE_ONE, "demo.sample-two"],
        permissionKeys: [
          "demo.*",
          "demo.sub.*",
          `${SAMPLE_ONE}.*`,
          "demo.sample-two.*",
        ],
      });
    });

    await actor.click(screen.getByRole("button", { name: "清空整組" }));
    await save(actor);
    await waitFor(() => {
      expect(fake.inputs.saveRoleMatrix.at(-1)).toEqual({
        roleId: "role-editor",
        moduleKeys: [],
        permissionKeys: [],
      });
    });
  });

  // 儲存後畫面「閃一下」—— 先跳回舊勾選、過一下才變新的。
  // 這裡把儲存後的矩陣重取**擋住不回**,畫面就只剩快取可用:mutation 的 payload
  // 沒被寫進 `roleMatrix` 的 key 的話,草稿一丟掉就退回儲存前那一份。
  it("儲存後不閃舊勾選(矩陣重取還沒回來也一樣)", async () => {
    const { user: actor } = await openMatrix();

    await actor.click(matrixCheckbox(`新增${SAMPLE_ONE}.create`));
    expect(matrixCheckbox(`新增${SAMPLE_ONE}.create`)).toBeChecked();

    server.use(
      api.query("RoleMatrix", async () => {
        await delay("infinite");
      }),
    );
    await save(actor);

    // 草稿被丟掉(= 儲存成功)之後,勾選狀態仍然是剛存進去的那一份
    await waitFor(() => {
      expect(screen.queryByText("有未儲存的變更")).not.toBeInTheDocument();
    });
    expect(matrixCheckbox(`新增${SAMPLE_ONE}.create`)).toBeChecked();
    expect(matrixCheckbox(`檢視${SAMPLE_ONE}.view`)).toBeChecked();
  });

  it("有未儲存的變更時切頁籤先問,放棄後才切過去且變更被丟掉", async () => {
    const { user: actor } = await openMatrix();

    await actor.click(matrixCheckbox(`新增${SAMPLE_ONE}.create`));
    expect(screen.getByText("有未儲存的變更")).toBeInTheDocument();

    await actor.click(screen.getByRole("tab", { name: "分配使用者" }));
    expect(await screen.findByText("放棄未儲存的變更?")).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "放棄變更" }));
    expect(
      await screen.findByText("內容編輯 — 分配使用者"),
    ).toBeInTheDocument();

    await actor.click(screen.getByRole("tab", { name: "權限設定" }));
    await screen.findByText("內容編輯 — 權限設定");
    expect(matrixCheckbox(`新增${SAMPLE_ONE}.create`)).not.toBeChecked();
    expect(screen.queryByText("有未儲存的變更")).not.toBeInTheDocument();
  });

  it("租戶副本只能縮:目前沒有的項目直接不可勾", async () => {
    renderRolePage({ world: { shrinkOnly: true } });

    await screen.findByText("示範模組1");
    expect(
      screen.getByText(
        "這是系統在開通時幫你準備好的角色,權限只能縮不能擴 — 目前沒有的項目不能勾選。",
      ),
    ).toBeInTheDocument();
    expect(matrixCheckbox(`新增${SAMPLE_ONE}.create`)).toBeDisabled();
    expect(matrixCheckbox(`檢視${SAMPLE_ONE}.view`)).toBeEnabled();
  });

  it("預設角色的天花板:模板沒有的列不可勾,模板有的列(尚未授予)仍可勾", async () => {
    // 天花板含示範模組1整層,但不含示範模組2 —— root 視角(shrinkOnly = false)也照鎖
    renderRolePage({
      world: {
        ceiling: {
          moduleKeys: ["demo", "demo.sub", SAMPLE_ONE],
          permissionKeys: [
            `${SAMPLE_ONE}.*`,
            `${SAMPLE_ONE}.view`,
            `${SAMPLE_ONE}.create`,
            `${SAMPLE_ONE}.edit`,
          ],
        },
      },
    });

    await screen.findByText("示範模組1");
    expect(
      screen.getByText(
        "這個角色的可勾選範圍以系統內建的角色範本為上限 — 範本未包含的項目是灰色的,不能勾選。",
      ),
    ).toBeInTheDocument();
    // 天花板內、目前沒勾的列照樣勾得動(這正是 shrinkOnly 與天花板的差別)
    expect(matrixCheckbox(`新增${SAMPLE_ONE}.create`)).toBeEnabled();
    // 天花板外
    expect(matrixCheckbox("示範模組2demo.sample-two")).toBeDisabled();
    expect(matrixCheckbox("檢視demo.sample-two.view")).toBeDisabled();
  });
});
