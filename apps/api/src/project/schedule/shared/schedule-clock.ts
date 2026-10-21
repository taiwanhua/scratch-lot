import { Injectable } from "@nestjs/common";

/**
 * 排班讀「現在」的唯一入口(畫休開放期間、截止後代改要原因都看今天)。
 * 測試以 `jest.spyOn(app.get(ScheduleClock), "now")` 注入時鐘,不必假造全域 Date。
 */
@Injectable()
export class ScheduleClock {
  now(): Date {
    return new Date();
  }
}
