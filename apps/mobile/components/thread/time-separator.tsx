import { formatTimeSeparator } from "@anviq/core";
import { typeScale } from "@anviq/ui-tokens";
import { useLingui } from "@lingui/react/macro";
import { Text } from "react-native";
import { mobileTokens } from "../../lib/appearance/appearance";
import { dateLocaleForUi, useUiLocale } from "../../lib/i18n/i18n";

export function TimeSeparator({ createdAt }: { createdAt?: string }) {
  const { t } = useLingui();
  const locale = useUiLocale();
  if (!createdAt) return null;
  return (
    <Text
      accessibilityRole="header"
      selectable={false}
      style={{
        color: mobileTokens().faintForeground,
        ...typeScale.caption,
        textAlign: "center",
        marginVertical: 12,
      }}
    >
      {formatTimeSeparator(createdAt, dateLocaleForUi(locale), {
        today: t`Today`,
        yesterday: t`Yesterday`,
      })}
    </Text>
  );
}
