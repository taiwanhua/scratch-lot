import { appendFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * 代理程式的紀錄:**每天一個 log 檔、保留 14 天**。
 * 檔名 `print-agent-YYYY-MM-DD.log`(本機日期);換日(與啟動)時刪掉超過保留天數的檔。
 * 量很小(每張工作幾行),同步寫入即可;絕不寫入代理程式金鑰。
 */
export type LogLevel = "info" | "warn" | "error";

export type LogFields = Record<
  string,
  string | number | boolean | null | undefined
>;

export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export const LOG_RETENTION_DAYS = 14;

const LOG_FILE = /^print-agent-(\d{4}-\d{2}-\d{2})\.log$/;

const pad = (value: number) => String(value).padStart(2, "0");

/** 本機日期 `YYYY-MM-DD`。 */
export function localDate(date: Date): string {
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function logFileName(date: Date): string {
  return `print-agent-${localDate(date)}.log`;
}

/** 某一天要刪掉的 log 檔(含今天共保留 `retentionDays` 天)。 */
export function expiredLogFiles(
  names: readonly string[],
  today: Date,
  retentionDays = LOG_RETENTION_DAYS,
): string[] {
  const oldest = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - (retentionDays - 1),
  );
  const cutoff = localDate(oldest);
  return names.filter((name) => {
    const match = LOG_FILE.exec(name);
    return match?.[1] !== undefined && match[1] < cutoff;
  });
}

export function formatLine(
  level: LogLevel,
  message: string,
  fields: LogFields | undefined,
  at: Date,
): string {
  const extra =
    fields === undefined
      ? ""
      : Object.entries(fields)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => ` ${key}=${JSON.stringify(value)}`)
          .join("");
  return `${at.toISOString()} ${level.toUpperCase()} ${message}${extra}\n`;
}

export interface DailyFileLoggerOptions {
  dir: string;
  now?: () => Date;
  retentionDays?: number;
  /** 同時輸出到哪裡(服務模式下 = stdout,讓 WinSW / journald 也看得到);不給就只寫檔。 */
  echo?: (line: string) => void;
}

export class DailyFileLogger implements Logger {
  private readonly now: () => Date;
  private readonly retentionDays: number;
  private currentDay: string | null = null;

  constructor(private readonly options: DailyFileLoggerOptions) {
    this.now = options.now ?? (() => new Date());
    this.retentionDays = options.retentionDays ?? LOG_RETENTION_DAYS;
  }

  info(message: string, fields?: LogFields): void {
    this.write("info", message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.write("warn", message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.write("error", message, fields);
  }

  private write(
    level: LogLevel,
    message: string,
    fields: LogFields | undefined,
  ): void {
    const at = this.now();
    const line = formatLine(level, message, fields, at);
    this.options.echo?.(line);
    try {
      const day = localDate(at);
      if (day !== this.currentDay) {
        mkdirSync(this.options.dir, { recursive: true });
        this.currentDay = day;
        this.prune(at);
      }
      appendFileSync(
        path.join(this.options.dir, logFileName(at)),
        line,
        "utf8",
      );
    } catch {
      // 寫不進 log(磁碟滿、權限)不能讓列印停下來;echo 那份仍在
    }
  }

  private prune(today: Date): void {
    for (const name of expiredLogFiles(
      readdirSync(this.options.dir),
      today,
      this.retentionDays,
    )) {
      rmSync(path.join(this.options.dir, name), { force: true });
    }
  }
}
