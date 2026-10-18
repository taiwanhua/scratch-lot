import { Inject, Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import type { Persisted } from "../database/base.repository";
import {
  type UserPreferenceDocument,
  UserPreferencesRepository,
} from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import {
  type UserPreferenceDefinition,
  isValidPreferenceValue,
} from "./user-preference-registry";
import { USER_PREFERENCE_REGISTRY } from "./user-preference-registry.module";
import { userPreferenceRejected } from "./user-preferences-error";

/** Mongo 的 duplicate key(唯一索引撞到:同一個使用者的第一筆被兩個請求同時建立)。 */
const DUPLICATE_KEY = 11_000;

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: unknown }).code === DUPLICATE_KEY;

/**
 * 個人偏好:每個使用者一筆 `user_preferences`,只能讀寫**自己的**(身分取自登入,不收 userId)。
 * 讀:每個登記的 key 都給值(存過的值,沒存過 = 預設值);存著但已不再登記的 key 不回。
 * 寫:逐 key 驗登記與型別,全部通過才寫;值 `null` = 拿掉這個 key。
 */
@Injectable()
export class UserPreferencesService {
  constructor(
    private readonly preferences: UserPreferencesRepository,
    @Inject(USER_PREFERENCE_REGISTRY)
    private readonly registry: ReadonlyMap<string, UserPreferenceDefinition>,
  ) {}

  async mine(operator: OperatorContext): Promise<Record<string, unknown>> {
    const document = await this.preferences.findOne(operator, {
      userId: this.userIdOf(operator),
    });
    return this.resolve(document?.settings ?? {});
  }

  async updateMine(
    operator: OperatorContext,
    changes: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const $set: Record<string, unknown> = {};
    const $unset: Record<string, ""> = {};
    for (const [key, value] of Object.entries(changes)) {
      const definition = this.registry.get(key);
      if (definition === undefined) {
        throw userPreferenceRejected("UNKNOWN_KEY", key);
      }
      if (value === null) {
        $unset[`settings.${key}`] = "";
      } else if (isValidPreferenceValue(definition, value)) {
        $set[`settings.${key}`] = value;
      } else {
        throw userPreferenceRejected("INVALID_VALUE", key);
      }
    }
    const userId = this.userIdOf(operator);
    const update = {
      ...(Object.keys($set).length > 0 && { $set }),
      ...(Object.keys($unset).length > 0 && { $unset }),
    };
    if (Object.keys(update).length === 0) {
      return this.mine(operator);
    }
    const document = await this.write(operator, userId, update);
    return this.resolve(document.settings);
  }

  /** 有那一筆就條件更新;還沒有就建立(撞到唯一索引 = 別的請求剛建好,改回更新)。 */
  private async write(
    operator: OperatorContext,
    userId: Types.ObjectId,
    update: { $set?: Record<string, unknown>; $unset?: Record<string, ""> },
  ): Promise<Persisted<UserPreferenceDocument>> {
    const updated = await this.preferences.findOneAndUpdate(
      operator,
      { userId },
      update,
    );
    if (updated !== null) {
      return updated;
    }
    const settings: Record<string, unknown> = {};
    for (const [path, value] of Object.entries(update.$set ?? {})) {
      settings[path.slice("settings.".length)] = value;
    }
    try {
      return await this.preferences.create(operator, { userId, settings });
    } catch (error) {
      if (!isDuplicateKey(error)) {
        throw error;
      }
      const retried = await this.preferences.findOneAndUpdate(
        operator,
        { userId },
        update,
      );
      if (retried === null) {
        throw error;
      }
      return retried;
    }
  }

  /** 登記的每個 key 都給值:存過且仍合型別的值,否則預設值。 */
  private resolve(stored: Record<string, unknown>): Record<string, unknown> {
    const settings: Record<string, unknown> = {};
    for (const [key, definition] of this.registry) {
      const value = stored[key];
      settings[key] = isValidPreferenceValue(definition, value)
        ? value
        : definition.defaultValue;
    }
    return settings;
  }

  private userIdOf(operator: OperatorContext): Types.ObjectId {
    if (operator.actorId === null) {
      throw new Error(
        "個人偏好只給已登入的使用者讀寫(operator.actorId 為 null)",
      );
    }
    return operator.actorId;
  }
}
