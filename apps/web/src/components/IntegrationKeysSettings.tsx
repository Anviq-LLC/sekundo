import type { IntegrationProviderConfig, IntegrationProviderId } from "@anviq/contracts";
import { Button, Disclosure, Input, NativeSelect, NativeSelectOption } from "@anviq/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

const DOTS = "••••••••";

/** Each person connects apps with their own provider accounts, so these credentials are theirs alone. */
export function IntegrationKeysSettings() {
  const { t } = useLingui();
  const [configured, setConfigured] = useState<Partial<Record<IntegrationProviderId, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void rpc.integrationSetup
      .get()
      .then((state) => {
        if (!cancelled)
          setConfigured(Object.fromEntries(state.providers.map((p) => [p.id, p.configured])));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(config: IntegrationProviderConfig) {
    setBusy(true);
    setError(null);
    try {
      await rpc.integrationSetup.save(config);
      setConfigured((current) => ({ ...current, [config.provider]: true }));
    } catch (err) {
      setError(errorText(err, t`Could not save the credentials`));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <ComposioForm configured={Boolean(configured.composio)} busy={busy} onSave={save} />
      <Disclosure className="text-sm text-muted-foreground" summary="Pipedream">
        <PipedreamForm configured={Boolean(configured.pipedream)} busy={busy} onSave={save} />
      </Disclosure>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type FormProps = {
  configured: boolean;
  busy: boolean;
  onSave: (config: IntegrationProviderConfig) => Promise<void>;
};

function ComposioForm({ configured, busy, onSave }: FormProps) {
  const { t } = useLingui();
  const [key, setKey] = useState("");
  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave({ provider: "composio", apiKey: key.trim() }).then(
          () => setKey(""),
          () => undefined,
        );
      }}
    >
      <Input
        type="password"
        autoComplete="off"
        aria-label={t`Composio API key`}
        placeholder={configured ? DOTS : t`Composio API key`}
        value={key}
        onChange={(event) => setKey(event.target.value)}
      />
      <Button type="submit" disabled={busy || !key.trim()}>
        <Trans>Save</Trans>
      </Button>
    </form>
  );
}

function PipedreamForm({ configured, busy, onSave }: FormProps) {
  const { t } = useLingui();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [projectId, setProjectId] = useState("");
  const [environment, setEnvironment] = useState<"production" | "development">("production");
  const ready = clientId.trim() && clientSecret.trim() && projectId.trim();
  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave({
          provider: "pipedream",
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          projectId: projectId.trim(),
          environment,
        }).then(
          () => {
            setClientId("");
            setClientSecret("");
            setProjectId("");
          },
          () => undefined,
        );
      }}
    >
      <Input
        autoComplete="off"
        aria-label={t`Pipedream client ID`}
        placeholder={configured ? DOTS : t`Pipedream client ID`}
        value={clientId}
        onChange={(event) => setClientId(event.target.value)}
      />
      <Input
        type="password"
        autoComplete="off"
        aria-label={t`Pipedream client secret`}
        placeholder={configured ? DOTS : t`Pipedream client secret`}
        value={clientSecret}
        onChange={(event) => setClientSecret(event.target.value)}
      />
      <Input
        autoComplete="off"
        aria-label={t`Pipedream project ID`}
        placeholder={configured ? DOTS : t`Pipedream project ID`}
        value={projectId}
        onChange={(event) => setProjectId(event.target.value)}
      />
      <NativeSelect
        aria-label={t`Environment`}
        value={environment}
        onChange={(event) => setEnvironment(event.target.value as "production" | "development")}
      >
        <NativeSelectOption value="production">{t`Production`}</NativeSelectOption>
        <NativeSelectOption value="development">{t`Development`}</NativeSelectOption>
      </NativeSelect>
      <Button type="submit" disabled={busy || !ready}>
        <Trans>Save</Trans>
      </Button>
    </form>
  );
}
