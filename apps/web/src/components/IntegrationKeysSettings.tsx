import { Disclosure } from "@anviq/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useSave, useSpaceQueries } from "../lib/query/query";
import { errorText } from "../lib/query/user-error";
import { ProviderSettingsForm } from "./models/ProviderSettingsForm";

/** Each person connects apps with their own provider accounts, so these credentials are theirs alone. */
export function IntegrationKeysSettings() {
  const { t } = useLingui();
  const spaceQueries = useSpaceQueries();
  const state = useQuery(spaceQueries.integrationSetup.get.queryOptions());
  const save = useSave({
    save: (config: { provider: string; [key: string]: string }, client) =>
      client.integrationSetup.save(config),
    stale: [spaceQueries.integrationSetup.get.queryKey()],
  });
  const providers = state.data?.providers ?? [];

  return (
    <div className="space-y-6">
      {providers.map((provider, index) => (
        <Disclosure
          key={`${provider.id}:${provider.configured}`}
          defaultOpen={index === 0}
          className="text-sm text-muted-foreground"
          summary={provider.displayName ?? provider.id}
        >
          <div className="mt-3">
            <ProviderSettingsForm
              fields={provider.fields ?? []}
              busy={save.pending}
              connectLabel={t`Save`}
              advancedSettings={null}
              onSubmit={(draft) =>
                save.run({
                  provider: provider.id,
                  ...draft.settings,
                  ...draft.credentials,
                })
              }
            />
          </div>
        </Disclosure>
      ))}
      {save.error ? (
        <p role="alert" className="text-sm text-destructive">
          {errorText(save.error)}
        </p>
      ) : null}
    </div>
  );
}
