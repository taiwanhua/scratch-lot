import { useState } from "react";

import { type UploadPurpose, useCreateUploadUrlMutation } from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";

import type { DemoUploadedFile } from "./demo-module-config";

/**
 * 示範項目的檔案上傳(ADR-0010 的三步,封面與附件共用;沿用 #138 商標上傳的型式):
 * 1. `createUploadUrl` 向 api 要一張簽名上傳票(檔型 / 大小不合會在這一步回 `UPLOAD_REJECTED`)
 * 2. 瀏覽器把檔案 `PUT` 到 `uploadUrl` — 直傳 bucket,不經過 api
 * 3. 回來的 `objectPath` 連同原始檔名 / 大小 / 檔型(`File.name` / `size` / `type`,#427)交回呼叫端,
 *    由設定物件決定怎麼放進 create / update(封面只用路徑、附件四個都送)
 *
 * 封面與附件的差別只有 `purpose`:api 依用途決定放公開還是私有 bucket(前端不選 bucket)。
 * 沒選檔就回 `null`,呼叫端據此決定「不動」還是「清空」。
 */
export const useDemoUpload = () => {
  const { session } = useSession();
  const [isUploading, setIsUploading] = useState(false);
  const createUploadUrl = useCreateUploadUrlMutation(session.client);

  const upload = async (
    file: File | null,
    purpose: UploadPurpose,
  ): Promise<DemoUploadedFile | null> => {
    if (file === null) {
      return null;
    }
    setIsUploading(true);
    try {
      const { createUploadUrl: ticket } = await createUploadUrl.mutateAsync({
        input: { purpose, contentType: file.type, size: file.size },
      });
      const response = await fetch(ticket.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) {
        throw new Error(`Demo upload failed: ${String(response.status)}`);
      }
      return {
        path: ticket.objectPath,
        name: file.name,
        size: file.size,
        contentType: file.type,
      };
    } finally {
      setIsUploading(false);
    }
  };

  return { upload, isUploading };
};
