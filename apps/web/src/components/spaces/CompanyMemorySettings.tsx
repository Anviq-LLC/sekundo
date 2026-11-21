import { Button, Textarea } from "@anviq/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useQueryUserId, useSave } from "../../lib/query/query";
import { errorText } from "../../lib/query/user-error";
import type { Organization } from "../../lib/spaces/organizations";
import { companyMemoryQuery, memoryProposalsQuery } from "../../lib/spaces/organizations";
import { SettingsPageHeader } from "../settings/SettingsPageHeader";
import { SettingsGroup } from "../settings/SettingsRows";

/** Notes every bot in the organization reads. Owners and admins edit; members suggest additions. */
export function CompanyMemorySettings({
  organization,
  onBack,
}: {
  organization: Organization;
  onBack: () => void;
}) {
  const { t } = useLingui();
  const userId = useQueryUserId();
  const organizationId = organization.id;
  const memoryKey = companyMemoryQuery(userId, organizationId);
  const proposalsKey = memoryProposalsQuery(userId, organizationId);
  const memory = useQuery(memoryKey).data;
  const proposals = useQuery(proposalsKey).data ?? [];
  const [draft, setDraft] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState("");

  const save = useSave({
    save: (content: string, rpc) =>
      rpc.organizations.memory.set({
        organizationId,
        content,
        expectedRevision: memory?.revision,
      }),
    stale: [memoryKey.queryKey],
    onSaved: () => setDraft(null),
  });
  const suggest = useSave({
    save: (content: string, rpc) => rpc.organizations.memory.propose({ organizationId, content }),
    stale: [proposalsKey.queryKey],
    onSaved: () => setSuggestion(""),
  });
  const decide = useSave({
    save: (ask: { proposalId: string; approve: boolean }, rpc) =>
      rpc.organizations.memory.decide(ask),
    stale: [proposalsKey.queryKey, memoryKey.queryKey],
  });

  const canEdit = memory?.canEdit === true;
  const text = draft ?? memory?.content ?? "";
  const error = save.error ?? suggest.error ?? decide.error;

  return (
    <div className="space-y-6" data-testid="company-memory">
      <SettingsPageHeader title={t`Company memory`} onBack={onBack} />
      <Textarea
        aria-label={t`Company memory`}
        className="min-h-48"
        value={text}
        readOnly={!canEdit}
        maxLength={20_000}
        onChange={(event) => {
          setDraft(event.target.value);
          save.reset();
        }}
      />
      {canEdit && draft !== null ? (
        <Button disabled={save.pending} onClick={() => save.run(draft)}>
          <Trans>Save</Trans>
        </Button>
      ) : null}
      {!canEdit ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            const note = suggestion.trim();
            if (note) suggest.run(note);
          }}
        >
          <Textarea
            aria-label={t`Suggest an addition`}
            value={suggestion}
            maxLength={4000}
            onChange={(event) => setSuggestion(event.target.value)}
          />
          <Button type="submit" disabled={suggest.pending || !suggestion.trim()}>
            <Trans>Suggest</Trans>
          </Button>
        </form>
      ) : null}
      {proposals.length > 0 ? (
        <SettingsGroup>
          {proposals.map((proposal) => (
            <div key={proposal.id} className="space-y-2 px-4 py-3">
              <p className="whitespace-pre-wrap text-body">{proposal.content}</p>
              <p className="text-body-sm text-muted-foreground">{proposal.proposedBy}</p>
              {canEdit ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={decide.pending}
                    onClick={() => decide.run({ proposalId: proposal.id, approve: true })}
                  >
                    <Trans>Approve</Trans>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decide.pending}
                    onClick={() => decide.run({ proposalId: proposal.id, approve: false })}
                  >
                    <Trans>Reject</Trans>
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </SettingsGroup>
      ) : null}
      {error ? (
        <p role="alert" className="text-body-sm text-destructive">
          {errorText(error)}
        </p>
      ) : null}
    </div>
  );
}
