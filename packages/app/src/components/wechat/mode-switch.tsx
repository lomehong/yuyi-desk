/**
 * 顶层模式切换器（左上角，标题栏 chrome 区）：工作台 / 微信 分段切换，
 * 参考码道 Agent Space 的 IDI/Space 形态。切换由调用方路由跳转，
 * 模式持久化在 wechat-mode-store。
 */
import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { useTopLevelMode, type AppTopLevelMode } from "@/stores/wechat-mode-store";

export function ModeSwitch({
  onModeChange,
}: {
  onModeChange: (mode: AppTopLevelMode) => void;
}): ReactElement {
  const { t } = useTranslation();
  const mode = useTopLevelMode();

  const handleValueChange = useCallback(
    (next: AppTopLevelMode) => {
      onModeChange(next);
    },
    [onModeChange],
  );

  return (
    <SegmentedControl
      size="sm"
      value={mode}
      onValueChange={handleValueChange}
      options={[
        { value: "workbench", label: t("mode.workbench"), testID: "mode-workbench" },
        { value: "wechat", label: t("mode.wechat"), testID: "mode-wechat" },
      ]}
      testID="mode-switch"
    />
  );
}
