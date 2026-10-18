import { Injectable } from "@nestjs/common";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 60 * 1000;

interface AttemptRecord {
  failures: number;
  lockedUntil: number | null;
}

/**
 * 登入節流:同帳號連續失敗 5 次鎖 1 分鐘。
 * 記憶體計數、單實例語意(v1 可接受;多實例一致的節流列為 out of scope)。
 */
@Injectable()
export class LoginThrottle {
  private readonly records = new Map<string, AttemptRecord>();

  /** 帳號目前是否被鎖(鎖到期即自動解除)。 */
  isLocked(account: string, now = Date.now()): boolean {
    const record = this.records.get(account);
    if (!record?.lockedUntil) {
      return false;
    }
    if (record.lockedUntil <= now) {
      this.records.delete(account);
      return false;
    }
    return true;
  }

  recordFailure(account: string, now = Date.now()): void {
    const record = this.records.get(account) ?? {
      failures: 0,
      lockedUntil: null,
    };
    record.failures += 1;
    if (record.failures >= MAX_FAILED_ATTEMPTS) {
      record.lockedUntil = now + LOCK_DURATION_MS;
      record.failures = 0;
    }
    this.records.set(account, record);
  }

  recordSuccess(account: string): void {
    this.records.delete(account);
  }
}
