// Copyright 2026 Anviq LLC. All rights reserved.
import type { OrganizationRole, Team } from "@anviq/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Input,
  NativeSelect,
  NativeSelectOption,
  Textarea,
} from "@anviq/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { authClient } from "../lib/auth";
import { rpc, selectSpace } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { useIdentityConfirmation } from "./ConfirmIdentityDialog";
import { SettingsGroup, SettingsRow } from "./SettingsRows";

const TEAMS = ["organizations"] as const;
const canManage = (role: OrganizationRole) => role === "owner" || role === "admin";

/** Switches the app into a space; the whole shell reloads because another space is an auth boundary. */
export function openSpace(spaceId: string) {
  if (selectSpace(spaceId)) window.location.assign("/app");
}

function useAction() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const action = useMutation({
    mutationFn: async (work: () => Promise<unknown>) => work(),
    onMutate: () => setError(null),
    onError: (failure) => setError(errorText(failure)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: TEAMS }),
  });
  return {
    run: (work: () => Promise<unknown>) => action.mutateAsync(work).catch(() => undefined),
    busy: action.isPending,
    error,
  };
}

export function TeamSettings() {
  const { t } = useLingui();
  const [teamId, setTeamId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const { run, busy, error } = useAction();
  const teams = useQuery({ queryKey: [...TEAMS, "list"], queryFn: () => rpc.organizations.list() });
  const personal = useQuery({
    queryKey: [...TEAMS, "personal"],
    queryFn: () => rpc.organizations.personalSpace(),
  });
  const mine = useQuery({
    queryKey: [...TEAMS, "mine"],
    queryFn: () => rpc.organizations.myInvitations(),
  });
  const team = teams.data?.find((item) => item.id === teamId) ?? null;
  if (team) return <TeamDetail team={team} onBack={() => setTeamId(null)} />;

  return (
    <div className="space-y-8">
      {mine.data?.length ? (
        <SettingsGroup title={t`Invitations`}>
          {mine.data.map((invitation) => (
            <SettingsRow
              key={invitation.id}
              label={
                <>
                  <p className="break-words">{invitation.organizationName}</p>
                  <p className="text-[13px] text-muted-foreground">{invitation.inviterName}</p>
                </>
              }
              control={
                <Button
                  size="sm"
                  className="rounded-full"
                  disabled={busy}
                  onClick={() =>
                    void run(async () =>
                      openSpace(
                        (await rpc.organizations.acceptInvitation({ invitationId: invitation.id }))
                          .spaceId,
                      ),
                    )
                  }
                >
                  {t`Join`}
                </Button>
              }
            />
          ))}
        </SettingsGroup>
      ) : null}

      <SettingsGroup title={t`Teams`}>
        {personal.data?.spaceId ? (
          <SettingsRow
            label={t`Personal`}
            control={
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full"
                onClick={() => openSpace(personal.data.spaceId as string)}
              >
                {t`Open`}
              </Button>
            }
          />
        ) : null}
        {teams.data?.map((item) => (
          <SettingsRow
            key={item.id}
            label={<p className="break-words">{item.name}</p>}
            control={
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full"
                  onClick={() => openSpace(item.spaceId)}
                >
                  {t`Open`}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full"
                  aria-label={t`Manage ${item.name}`}
                  onClick={() => setTeamId(item.id)}
                >
                  {t`Manage`}
                </Button>
              </>
            }
          />
        ))}
        <form
          className="flex items-center gap-2 px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            const next = name.trim();
            if (!next) return;
            void run(async () => {
              const created = await rpc.organizations.create({ name: next });
              openSpace(created.defaultSpaceId);
            });
          }}
        >
          <Input
            value={name}
            maxLength={60}
            aria-label={t`Team name`}
            placeholder={t`New team`}
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" size="sm" className="rounded-full" disabled={busy || !name.trim()}>
            {t`Create`}
          </Button>
        </form>
      </SettingsGroup>
      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** What every bot in the team knows. Members read it; owners and admins edit it. */
function CompanyMemory({ team }: { team: Team }) {
  const { t } = useLingui();
  const { run, busy, error } = useAction();
  const queryClient = useQueryClient();
  const memory = useQuery({
    queryKey: [...TEAMS, "memory", team.id],
    queryFn: () => rpc.organizations.memory({ organizationId: team.id }),
  });
  const [draft, setDraft] = useState<string | null>(null);
  if (!memory.data) return null;
  const { canEdit, content, revision } = memory.data;
  const text = draft ?? content;
  return (
    <SettingsGroup title={t`Company memory`}>
      <div className="space-y-3 px-4 py-3">
        {canEdit || content ? (
          <Textarea
            value={text}
            readOnly={!canEdit}
            rows={6}
            maxLength={20000}
            aria-label={t`Company memory`}
            onChange={(event) => setDraft(event.target.value)}
          />
        ) : null}
        {canEdit ? (
          <div className="flex items-center justify-end gap-2">
            {error ? (
              <p role="alert" className="me-auto text-[13px] text-destructive">
                {error}
              </p>
            ) : null}
            <Button
              size="sm"
              className="rounded-full"
              disabled={busy || draft === null || draft === content}
              onClick={() =>
                void run(async () => {
                  await rpc.organizations.setMemory({
                    organizationId: team.id,
                    content: text,
                    expectedRevision: revision,
                  });
                  await queryClient.invalidateQueries({ queryKey: [...TEAMS, "memory", team.id] });
                  setDraft(null);
                })
              }
            >
              {t`Save`}
            </Button>
          </div>
        ) : null}
      </div>
      <Suggestions team={team} canDecide={canEdit} />
    </SettingsGroup>
  );
}

/** A member suggests a note; an owner or admin approves or rejects what is waiting. */
function Suggestions({ team, canDecide }: { team: Team; canDecide: boolean }) {
  const { t } = useLingui();
  const { run, busy, error } = useAction();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const proposals = useQuery({
    queryKey: [...TEAMS, "proposals", team.id],
    queryFn: () => rpc.organizations.memoryProposals({ organizationId: team.id }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: [...TEAMS] });
  return (
    <>
      {proposals.data?.map((proposal) => (
        <SettingsRow
          key={proposal.id}
          label={
            <>
              <p className="whitespace-pre-wrap break-words">{proposal.content}</p>
              <p className="text-[13px] text-muted-foreground">{proposal.proposedBy}</p>
            </>
          }
          control={
            canDecide ? (
              <>
                <Button
                  size="sm"
                  className="rounded-full"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await rpc.organizations.decideMemoryProposal({
                        proposalId: proposal.id,
                        approve: true,
                      });
                      await refresh();
                    })
                  }
                >
                  {t`Approve`}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await rpc.organizations.decideMemoryProposal({
                        proposalId: proposal.id,
                        approve: false,
                      });
                      await refresh();
                    })
                  }
                >
                  {t`Reject`}
                </Button>
              </>
            ) : undefined
          }
        />
      ))}
      {canDecide ? null : (
        <form
          className="flex items-center gap-2 px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            const text = note.trim();
            if (!text) return;
            void run(async () => {
              await rpc.organizations.proposeMemory({ organizationId: team.id, content: text });
              setNote("");
              await refresh();
            });
          }}
        >
          <Input
            value={note}
            maxLength={4000}
            aria-label={t`Suggest a note`}
            placeholder={t`Suggest a note`}
            onChange={(event) => setNote(event.target.value)}
          />
          <Button type="submit" size="sm" className="rounded-full" disabled={busy || !note.trim()}>
            {t`Send`}
          </Button>
        </form>
      )}
      {error ? (
        <p role="alert" className="px-4 pb-3 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}

/** The team's log for its admins. */
function TeamActivity({ organizationId }: { organizationId: string }) {
  const { t } = useLingui();
  const events = useQuery({
    queryKey: [...TEAMS, "events", organizationId],
    queryFn: () => rpc.organizations.events({ organizationId }),
  });
  if (!events.data?.length) return null;
  const what: Record<string, string> = {
    "team.created": t`created the team`,
    "member.invited": t`invited`,
    "member.joined": t`joined`,
    "member.removed": t`removed`,
    "member.left": t`left`,
    "member.role_changed": t`changed a role`,
    "ownership.transferred": t`handed over ownership`,
    "memory.updated": t`edited company memory`,
    "memory.proposed": t`suggested a note`,
    "memory.approved": t`approved a suggestion`,
    "memory.rejected": t`rejected a suggestion`,
    "chat.shared": t`shared a chat`,
    "chat.unshared": t`stopped sharing a chat`,
  };
  return (
    <SettingsGroup title={t`Activity`}>
      {events.data.map((event) => (
        <SettingsRow
          key={event.id}
          label={
            <p className="break-words">
              {event.actorName} {what[event.type] ?? event.type}
              {event.subject && event.type === "member.invited" ? ` ${event.subject}` : ""}
            </p>
          }
          control={
            <span className="text-[13px] text-muted-foreground">
              {new Date(event.createdAt).toLocaleDateString()}
            </span>
          }
        />
      ))}
    </SettingsGroup>
  );
}

function TeamDetail({ team, onBack }: { team: Team; onBack: () => void }) {
  const { t } = useLingui();
  const { run, busy, error } = useAction();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const manager = canManage(team.role);
  const myId = authClient.useSession().data?.user.id;
  const { withIdentityConfirmation, identityDialog } = useIdentityConfirmation();
  const personal = useQuery({
    queryKey: [...TEAMS, "personal"],
    queryFn: () => rpc.organizations.personalSpace(),
  });
  const [confirm, setConfirm] = useState<{
    title: string;
    action: string;
    work: () => Promise<unknown>;
  } | null>(null);
  const members = useQuery({
    queryKey: [...TEAMS, "members", team.id],
    queryFn: () => rpc.organizations.members({ organizationId: team.id }),
  });
  const invitations = useQuery({
    queryKey: [...TEAMS, "invitations", team.id],
    queryFn: () => rpc.organizations.invitations({ organizationId: team.id }),
    enabled: manager,
  });
  const organizationId = team.id;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" aria-label={t`Back`} onClick={onBack}>
          <ChevronLeft className="rtl:rotate-180" />
        </Button>
        <h3 className="min-w-0 break-words text-[15px] font-medium">{team.name}</h3>
      </div>

      <CompanyMemory team={team} />

      <SettingsGroup title={t`People`}>
        {members.data?.map((member) => {
          const fixed = member.role === "owner";
          const self = member.userId === myId;
          return (
            <SettingsRow
              key={member.userId}
              label={
                <>
                  <p className="break-words">{member.name}</p>
                  <p className="break-words text-[13px] text-muted-foreground">{member.email}</p>
                </>
              }
              control={
                <>
                  {team.role === "owner" && !fixed ? (
                    <NativeSelect
                      value={member.role}
                      disabled={busy}
                      aria-label={t`Role of ${member.name}`}
                      onChange={(event) =>
                        void run(() =>
                          rpc.organizations.setRole({
                            organizationId,
                            userId: member.userId,
                            role: event.target.value as "admin" | "member",
                          }),
                        )
                      }
                    >
                      <NativeSelectOption value="member">{t`Member`}</NativeSelectOption>
                      <NativeSelectOption value="admin">{t`Admin`}</NativeSelectOption>
                    </NativeSelect>
                  ) : (
                    <span className="text-[13px] text-muted-foreground">
                      {member.role === "owner"
                        ? t`Owner`
                        : member.role === "admin"
                          ? t`Admin`
                          : t`Member`}
                    </span>
                  )}
                  {manager && !fixed && !self ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full"
                      disabled={busy}
                      aria-label={t`Remove ${member.name}`}
                      onClick={() =>
                        setConfirm({
                          title: t`Remove ${member.name}?`,
                          action: t`Remove`,
                          work: () =>
                            rpc.organizations.removeMember({
                              organizationId,
                              userId: member.userId,
                            }),
                        })
                      }
                    >
                      {t`Remove`}
                    </Button>
                  ) : null}
                  {team.role === "owner" && !fixed && !self ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full"
                      disabled={busy}
                      aria-label={t`Make ${member.name} the owner`}
                      onClick={() =>
                        setConfirm({
                          title: t`Make ${member.name} the owner?`,
                          action: t`Make owner`,
                          work: () =>
                            rpc.organizations.transferOwnership({
                              organizationId,
                              userId: member.userId,
                            }),
                        })
                      }
                    >
                      {t`Make owner`}
                    </Button>
                  ) : null}
                </>
              }
            />
          );
        })}
      </SettingsGroup>

      {manager ? (
        <SettingsGroup title={t`Invite`}>
          {invitations.data?.map((invitation) => (
            <SettingsRow
              key={invitation.id}
              label={<p className="break-words">{invitation.email}</p>}
              control={
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      rpc.organizations.cancelInvitation({ invitationId: invitation.id }),
                    )
                  }
                >
                  {t`Cancel`}
                </Button>
              }
            />
          ))}
          <form
            className="flex flex-wrap items-center gap-2 px-4 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              const address = email.trim();
              if (!address) return;
              void run(async () => {
                await rpc.organizations.invite({ organizationId, email: address, role });
                setEmail("");
              });
            }}
          >
            <Input
              type="email"
              value={email}
              className="min-w-0 flex-1"
              aria-label={t`Email`}
              placeholder={t`name@company.com`}
              onChange={(event) => setEmail(event.target.value)}
            />
            {team.role === "owner" ? (
              <NativeSelect
                value={role}
                aria-label={t`Role`}
                onChange={(event) => setRole(event.target.value as "admin" | "member")}
              >
                <NativeSelectOption value="member">{t`Member`}</NativeSelectOption>
                <NativeSelectOption value="admin">{t`Admin`}</NativeSelectOption>
              </NativeSelect>
            ) : null}
            <Button
              type="submit"
              size="sm"
              className="rounded-full"
              disabled={busy || !email.trim()}
            >
              {t`Send`}
            </Button>
          </form>
        </SettingsGroup>
      ) : null}

      {manager ? <TeamActivity organizationId={organizationId} /> : null}

      {team.role !== "owner" ? (
        <Button
          variant="ghost"
          className="text-destructive"
          disabled={busy}
          onClick={() =>
            setConfirm({
              title: t`Leave ${team.name}?`,
              action: t`Leave team`,
              work: async () => {
                await rpc.organizations.leave({ organizationId });
                onBack();
              },
            })
          }
        >
          {t`Leave team`}
        </Button>
      ) : (
        <Button
          variant="ghost"
          className="text-destructive"
          disabled={busy}
          onClick={() =>
            setConfirm({
              title: t`Delete ${team.name}?`,
              action: t`Delete team`,
              work: async () => {
                await withIdentityConfirmation(() => rpc.organizations.remove({ organizationId }));
                const spaceId = personal.data?.spaceId;
                if (spaceId) openSpace(spaceId);
                else onBack();
              },
            })
          }
        >
          {t`Delete team`}
        </Button>
      )}
      {identityDialog}
      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t`Cancel`}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() => {
                const work = confirm?.work;
                setConfirm(null);
                if (work) void run(work);
              }}
            >
              {confirm?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
