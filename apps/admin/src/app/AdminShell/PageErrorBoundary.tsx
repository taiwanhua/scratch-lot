import { Component, type ReactNode } from "react";
import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { isChunkLoadError } from "@/lib/base/app-version";
import { useAppUpdateStore } from "@/stores/base/useAppUpdateStore";

export interface PageErrorFallbackProps {
  /** 按 [重新整理](測試用;預設 `location.reload()`) */
  onReload?: () => void;
}

/** 頁面區出錯時的替代畫面:版面同 `ForbiddenPage`(標題 + 說明 + 一顆按鈕)。 */
export const PageErrorFallback = ({
  onReload = () => {
    globalThis.location.reload();
  },
}: PageErrorFallbackProps) => {
  const t = useTranslations("admin.shell.pageError");

  return (
    <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
      <Typography variant="h4" component="h1">
        {t("title")}
      </Typography>
      <Typography color="textSecondary">{t("body")}</Typography>
      <Button variant="outlined" onClick={onReload}>
        {t("reload")}
      </Button>
    </Stack>
  );
};

export interface PageErrorBoundaryProps {
  /** 換了就重置(傳目前路徑:換到別頁就能恢復) */
  resetKey: string;
  children: ReactNode;
}

interface PageErrorBoundaryState {
  hasError: boolean;
}

/**
 * 殼的頁面區 error boundary(包在 `ShellLayout` 的 `<Outlet>` 外):頁面 render 拋錯時只換掉頁面區,
 * 側欄、AppBar、頁籤列與全站提示都留著。錯誤是 lazy chunk 載入失敗(部署後舊分頁)時,
 * 同時回報舊版 → `useAppUpdateNotice` 跳「系統已更新」提示。
 * error boundary 只能用 class 元件寫(React 沒有對應的 hook)。
 */
export class PageErrorBoundary extends Component<
  PageErrorBoundaryProps,
  PageErrorBoundaryState
> {
  override state: PageErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): PageErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown): void {
    if (isChunkLoadError(error)) {
      useAppUpdateStore.getState().markOutdated();
    }
  }

  override componentDidUpdate(previous: PageErrorBoundaryProps): void {
    if (this.state.hasError && previous.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  override render(): ReactNode {
    return this.state.hasError ? <PageErrorFallback /> : this.props.children;
  }
}
