import { Button, Input } from "@anviq/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useId, useState } from "react";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

/** Each person connects apps with their own Composio account, so the key is theirs alone. */
export function ComposioKeySettings() {
  const { t } = useLingui();
  const id = useId();
  const [configured, setConfigured] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void rpc.integrationSetup
      .get()
      .then((state) => {
        if (!cancelled)
          setConfigured(state.providers.some((p) => p.id === "composio" && p.configured));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await rpc.integrationSetup.save({ provider: "composio", apiKey: key.trim() });
      setKey("");
      setConfigured(true);
    } catch (err) {
      setError(errorText(err, t`Could not save the key`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label htmlFor={id} className="block text-[14px] text-muted-foreground">
        <Trans>Composio API key</Trans>
      </label>
      <div className="flex gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="off"
          placeholder={configured ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" : undefined}
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
        <Button type="submit" disabled={busy || !key.trim()}>
          <Trans>Save</Trans>
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
