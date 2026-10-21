import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type LotteryAllocationCellFieldsFragment,
  useSetLotteryAllocationMutation,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { inventoryErrorOf } from "@/lib/project/lottery/inventory-error";

import { type AllocationTextLabels, givenText } from "./allocation-text";

export interface AllocationEditDialogProps {
  store: { id: string; name: string };
  game: { id: string; gameCode: string; name: string };
  cell: LotteryAllocationCellFieldsFragment | undefined;
  labels: AllocationTextLabels;
  onClose: () => void;
}

/** 0 以上的整數;其他 → null。 */
const parsePlanned = (text: string): number | null => {
  const value = Number(text.trim());
  return text.trim() !== "" && Number.isInteger(value) && value >= 0
    ? value
    : null;
};

/**
 * 修改一格的預計要給本數(規格 7.6,`inventory.edit-allocations`;寫 audit_log)。
 * 庫存管理的矩陣、遊戲詳情、乙類詳情共用。手機全螢幕。
 */
export const AllocationEditDialog = ({
  store,
  game,
  cell,
  labels,
  onClose,
}: AllocationEditDialogProps) => {
  const t = useTranslations("admin.lotteryInventory");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const [planned, setPlanned] = useState(
    cell?.plannedBooks == null ? "" : String(cell.plannedBooks),
  );
  const [note, setNote] = useState(cell?.note ?? "");
  const [invalid, setInvalid] = useState(false);
  const save = useSetLotteryAllocationMutation(
    session.client,
    useMutationFeedback({
      success: t("allocations.saveSuccess"),
      error: (error) => t(`errors.${inventoryErrorOf(error).code}`),
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: ["LotteryAllocations"],
        });
        onClose();
      },
    }),
  );
  const submit = () => {
    const value = parsePlanned(planned);
    setInvalid(value === null);
    if (value === null) {
      return;
    }
    save.mutate({
      input: {
        orgId: store.id,
        gameId: game.id,
        plannedBooks: value,
        note: note.trim() === "" ? null : note.trim(),
      },
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="xs"
      title={t("allocations.editTitle")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={save.isPending} onClick={submit}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body2">
          {t("allocations.editTarget", {
            store: store.name,
            game: `${game.gameCode} ${game.name}`,
            given: givenText(cell, labels),
          })}
        </Typography>
        <TextField
          label={t("allocations.planned")}
          value={planned}
          required
          fullWidth
          error={invalid}
          helperText={invalid ? t("allocations.plannedInvalid") : undefined}
          slotProps={{ htmlInput: { inputMode: "numeric" } }}
          onChange={(event) => {
            setPlanned(event.target.value);
          }}
        />
        <TextField
          label={t("allocations.note")}
          value={note}
          fullWidth
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </Stack>
    </Dialog>
  );
};
