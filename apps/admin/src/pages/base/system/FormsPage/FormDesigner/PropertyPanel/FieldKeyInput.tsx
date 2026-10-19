import { useState } from "react";
import { useTranslations } from "use-intl";

import { TextField } from "@repo/ui/text-field";

import type { FieldKeyProblem } from "@/lib/base/form-engine/designer-ops";

export interface FieldKeyInputProps {
  value: string;
  /** 這個 key 能不能寫入:null = 可以;否則是被擋的原因(格式 / 保留字 / 與別的欄位重複) */
  problemOf: (key: string) => FieldKeyProblem | null;
  onCommit: (key: string) => void;
}

/**
 * 欄位 key 的輸入框(改 `key` 時當場擋重複與格式錯誤,不等檢查器):
 * 輸入框記住打到一半的字;合格才寫進定義,不合格就標紅、顯示原因、**不寫入**(定義裡的 key 維持上一個合格值)。
 * 面板以欄位的內部 id 當 React key,換選欄位時整個重掛,初始值重新取。
 */
export const FieldKeyInput = ({
  value,
  problemOf,
  onCommit,
}: FieldKeyInputProps) => {
  const t = useTranslations("admin.forms.property");
  const [text, setText] = useState(value);
  const problem = text === value ? null : problemOf(text);

  return (
    <TextField
      label={t("key")}
      size="small"
      value={text}
      error={problem !== null}
      helperText={problem === null ? t("keyHint") : t(`keyProblems.${problem}`)}
      onChange={(event) => {
        const next = event.target.value.trim();
        setText(next);
        if (next !== value && problemOf(next) === null) {
          onCommit(next);
        }
      }}
    />
  );
};
