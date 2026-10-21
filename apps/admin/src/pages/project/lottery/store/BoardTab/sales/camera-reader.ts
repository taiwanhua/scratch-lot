/**
 * 相機讀碼(專案規格 6.3、18.3「相機」):手機 / 平板的相機連續讀一維碼,讀到的碼交給呼叫端
 * (看板把它注入 B10 全域掃描,和條碼槍走同一條路)。實作用 `@zxing/browser` 的一維碼讀取器
 * (EAN / UPC / Code 128 / Code 39 / ITF / Codabar…);實票掃不出來就調整支援的碼制
 * (`docs/tmp/project-dis.md`「條碼實機測試清單」)。
 *
 * 測試以 `setCameraReaderFactory` 換成模擬的讀碼器(注入讀到的碼),不碰真的相機。
 */

/** 開著的讀碼:關掉相機。 */
export interface CameraReading {
  stop: () => void;
}

/** 在 `video` 上開相機、每讀到一個碼呼叫 `onCode`;打不開相機 → reject。 */
export type CameraReaderFactory = (
  video: HTMLVideoElement,
  onCode: (code: string) => void,
) => Promise<CameraReading>;

const zxingReader: CameraReaderFactory = async (video, onCode) => {
  const { BrowserMultiFormatOneDReader } = await import("@zxing/browser");
  const reader = new BrowserMultiFormatOneDReader();
  const controls = await reader.decodeFromConstraints(
    { video: { facingMode: "environment" } },
    video,
    (result) => {
      if (result) {
        onCode(result.getText());
      }
    },
  );
  return {
    stop: () => {
      controls.stop();
    },
  };
};

let factory: CameraReaderFactory = zxingReader;

/** 目前的讀碼器(相機掃描視窗用)。 */
export const cameraReaderFactory = (): CameraReaderFactory => factory;

/** 測試換成模擬的讀碼器;回復原本的函式。 */
export const setCameraReaderFactory = (
  next: CameraReaderFactory,
): (() => void) => {
  const previous = factory;
  factory = next;
  return () => {
    factory = previous;
  };
};

/** 同一個碼在這段時間內重複讀到只算一次(相機每秒讀很多次;連續掃描時換一張才算新的一次)。 */
export const REPEAT_WINDOW_MS = 2000;

/** 這台裝置有沒有相機,而且是手機 / 平板(觸控為主的指標)。只在這種裝置顯示 [📷 掃描]。 */
export const detectCamera = async (): Promise<boolean> => {
  const coarse =
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(pointer: coarse)").matches;
  const devices = globalThis.navigator.mediaDevices as MediaDevices | undefined;
  if (!coarse || devices === undefined) {
    return false;
  }
  try {
    const list = await devices.enumerateDevices();
    return list.some((device) => device.kind === "videoinput");
  } catch {
    return false;
  }
};
