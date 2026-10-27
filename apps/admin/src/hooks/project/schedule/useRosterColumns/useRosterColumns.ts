import { useQueryClient } from "@tanstack/react-query";

import {
  SCHEDULE_ROSTER_COLUMNS_PREFERENCE_KEY,
  type ScheduleRosterStatColumn,
  rosterStatColumnsOf,
  rosterStatColumnsValue,
} from "@repo/domain/project/schedule-settings";
import {
  type MyPreferencesQuery,
  useMyPreferencesQuery,
  useUpdateMyPreferencesMutation,
} from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";

/**
 * 班表檢視 [⚙ 顯示欄位] 勾選的統計欄(規格 14.5:存個人偏好,換一台裝置登入也一樣;
 * api 登記 `scheduleRosterColumns`)。先改快取、背景寫回;還沒載到用預設欄。
 */
export const useRosterColumns = (): {
  columns: ScheduleRosterStatColumn[];
  setColumns: (columns: readonly ScheduleRosterStatColumn[]) => void;
} => {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const preferences = useMyPreferencesQuery(session.client, undefined, {
    staleTime: Number.POSITIVE_INFINITY,
  });
  const { mutate } = useUpdateMyPreferencesMutation(session.client);
  const columns = rosterStatColumnsOf(
    preferences.data?.myPreferences.settings[
      SCHEDULE_ROSTER_COLUMNS_PREFERENCE_KEY
    ],
  );
  const setColumns = (next: readonly ScheduleRosterStatColumn[]) => {
    const value = rosterStatColumnsValue(next);
    queryClient.setQueryData<MyPreferencesQuery>(
      useMyPreferencesQuery.getKey(),
      (current) =>
        current === undefined
          ? current
          : {
              ...current,
              myPreferences: {
                ...current.myPreferences,
                settings: {
                  ...current.myPreferences.settings,
                  [SCHEDULE_ROSTER_COLUMNS_PREFERENCE_KEY]: value,
                },
              },
            },
    );
    mutate({
      input: { settings: { [SCHEDULE_ROSTER_COLUMNS_PREFERENCE_KEY]: value } },
    });
  };
  return { columns, setColumns };
};
