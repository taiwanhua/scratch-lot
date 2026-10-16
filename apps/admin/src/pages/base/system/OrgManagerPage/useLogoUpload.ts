import { useState } from "react";

import { UploadPurpose, useCreateUploadUrlMutation } from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";

/**
 * 商標上傳(ADR-0010 的三步,編輯組織與開通租戶共用):
 * 1. `createUploadUrl` 向 api 要一張簽名上傳票(檔型 / 大小不合會在這一步回 `UPLOAD_REJECTED`)
 * 2. 瀏覽器把檔案 `PUT` 到 `uploadUrl` — 直傳私有 bucket,不經過 api
 * 3. 把回來的 `objectPath` 當成 `logoPath` 交給 `updateOrg` / `provisionTenant`
 *
 * 沒選檔就回 `null`(= 這次不動商標);呼叫端把 `null` 原樣傳給 mutation 代表「不變」。
 */
export const useLogoUpload = () => {
  const { session } = useSession();
  const [isUploading, setIsUploading] = useState(false);
  const createUploadUrl = useCreateUploadUrlMutation(session.client);

  const uploadLogo = async (file: File | null): Promise<string | null> => {
    if (file === null) {
      return null;
    }
    setIsUploading(true);
    try {
      const { createUploadUrl: ticket } = await createUploadUrl.mutateAsync({
        input: {
          purpose: UploadPurpose.OrgLogo,
          contentType: file.type,
          size: file.size,
        },
      });
      const response = await fetch(ticket.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) {
        throw new Error(`Logo upload failed: ${String(response.status)}`);
      }
      return ticket.objectPath;
    } finally {
      setIsUploading(false);
    }
  };

  return { uploadLogo, isUploading };
};
