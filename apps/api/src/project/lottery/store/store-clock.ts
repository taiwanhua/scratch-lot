import { Injectable } from "@nestjs/common";

/**
 * 店面讀「現在」的唯一入口(開班時間、找排班、今天的排班)。
 * 測試以 `jest.spyOn(app.get(StoreClock), "now")` 注入時鐘,不必假造全域 Date。
 */
@Injectable()
export class StoreClock {
  now(): Date {
    return new Date();
  }
}
