import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { LayoutGrid, MessageCircle } from "lucide-react-native";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useTopLevelMode, type AppTopLevelMode } from "@/stores/wechat-mode-store";
import { useWeChatData } from "@/stores/wechat-data-store";
import { formatUnreadCount } from "./wechat-model";

export function ModeSwitch({
  onModeChange,
}: {
  onModeChange: (mode: AppTopLevelMode) => void;
}): ReactElement {
  const { t } = useTranslation();
  const mode = useTopLevelMode();
  const { unread } = useWeChatData();
  const handleValueChange = useCallback(
    (next: AppTopLevelMode) => onModeChange(next),
    [onModeChange],
  );

  return (
    <SegmentedControl
      size="sm"
      value={mode}
      onValueChange={handleValueChange}
      options={[
        {
          value: "workbench",
          label: t("mode.workbench"),
          testID: "mode-workbench",
          icon: ({ color, size }) => <LayoutGrid color={color} size={size} />,
        },
        {
          value: "wechat",
          label: unread > 0 ? `${t("mode.wechat")} ${formatUnreadCount(unread)}` : t("mode.wechat"),
          testID: "mode-wechat",
          icon: ({ color, size }) => <MessageCircle color={color} size={size} />,
        },
      ]}
      testID="mode-switch"
    />
  );
}
