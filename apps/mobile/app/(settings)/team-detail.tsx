// Copyright 2026 Anviq LLC. All rights reserved.
import type {
  CompanyMemory,
  MemoryProposal,
  Team,
  TeamEvent,
  TeamInvitation,
  TeamMember,
} from "@anviq/contracts";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useIdentityConfirmation } from "../../components/confirm-identity";
import { LoadFailure } from "../../components/load-failure";
import { NativeActionButton } from "../../components/native-action-button";
import { SettingsGroup, SettingsRow } from "../../components/settings-group";
import { rpc, selectSpace } from "../../lib/api";
import { mobileTokens } from "../../lib/appearance";
import { useI18n } from "../../lib/i18n";
import { native, useThemedStyles } from "../../lib/native";
import { useSideInsets } from "../../lib/side-insets";
import { errorText } from "../../lib/user-error";

type Loaded = {
  members: TeamMember[];
  invitations: TeamInvitation[];
  memory: CompanyMemory;
  proposals: MemoryProposal[];
  events: TeamEvent[];
};

/** One team: who is in it, invitations, company memory with suggestions, and its activity. */
export default function TeamDetail() {
  const { organizationId, spaceId, role } = useLocalSearchParams<{
    organizationId: string;
    name?: string;
    spaceId?: string;
    role?: Team["role"];
  }>();
  const router = useRouter();
  const { t } = useI18n();
  const { withIdentityConfirmation, identityDialog } = useIdentityConfirmation();
  const sideInsets = useSideInsets();
  const styles = useThemedStyles(createStyles);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [myRole, setMyRole] = useState<Team["role"]>(role ?? "member");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const manager = myRole === "owner" || myRole === "admin";

  useFocusEffect(
    useCallback(() => {
      let current = true;
      void (async () => {
        try {
          const teams = await rpc("organizations/list");
          const mine = teams.find((team) => team.id === organizationId)?.role ?? "member";
          const isManager = mine === "owner" || mine === "admin";
          const [members, invitations, memory, proposals, events] = await Promise.all([
            rpc("organizations/members", { organizationId }),
            isManager ? rpc("organizations/invitations", { organizationId }) : Promise.resolve([]),
            rpc("organizations/memory", { organizationId }),
            rpc("organizations/memoryProposals", { organizationId }),
            isManager ? rpc("organizations/events", { organizationId }) : Promise.resolve([]),
          ]);
          if (!current) return;
          setMyRole(mine);
          setLoaded({ members, invitations, memory, proposals, events });
          setError(null);
        } catch (reason) {
          if (current) setError(errorText(reason, t("Something went wrong. Try again.")));
        }
      })();
      return () => {
        current = false;
      };
    }, [attempt, organizationId, t]),
  );

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
      setAttempt((count) => count + 1);
    } catch (reason) {
      setError(errorText(reason, t("Something went wrong. Try again.")));
    } finally {
      setBusy(false);
    }
  }

  function confirm(title: string, action: string, work: () => Promise<void>) {
    Alert.alert(title, undefined, [
      { text: t("Cancel"), style: "cancel" },
      { text: action, style: "destructive", onPress: () => void run(work) },
    ]);
  }

  function chooseFor(member: TeamMember) {
    const buttons = [];
    if (myRole === "owner") {
      buttons.push({
        text: member.role === "admin" ? t("Make member") : t("Make admin"),
        onPress: () =>
          void run(async () => {
            await rpc("organizations/setRole", {
              organizationId,
              userId: member.userId,
              role: member.role === "admin" ? "member" : "admin",
            });
          }),
      });
      buttons.push({
        text: t("Make owner"),
        onPress: () =>
          confirm(t("Make {name} the owner?", { name: member.name }), t("Make owner"), async () => {
            await rpc("organizations/transferOwnership", { organizationId, userId: member.userId });
          }),
      });
    }
    buttons.push({
      text: t("Remove"),
      style: "destructive" as const,
      onPress: () =>
        confirm(t("Remove {name}?", { name: member.name }), t("Remove"), async () => {
          await rpc("organizations/removeMember", { organizationId, userId: member.userId });
        }),
    });
    buttons.push({ text: t("Cancel"), style: "cancel" as const });
    Alert.alert(member.name, member.email, buttons);
  }

  const roleLabel = (value: TeamMember["role"]) =>
    value === "owner" ? t("Owner") : value === "admin" ? t("Admin") : t("Member");
  const eventLabel: Record<string, string> = {
    "team.created": t("created the team"),
    "member.invited": t("invited"),
    "member.joined": t("joined"),
    "member.removed": t("removed"),
    "member.left": t("left"),
    "member.role_changed": t("changed a role"),
    "ownership.transferred": t("handed over ownership"),
    "memory.updated": t("edited company memory"),
    "memory.proposed": t("suggested a note"),
    "memory.approved": t("approved a suggestion"),
    "memory.rejected": t("rejected a suggestion"),
    "chat.shared": t("shared a chat"),
    "chat.unshared": t("stopped sharing a chat"),
  };
  const memoryText = draft ?? loaded?.memory.content ?? "";

  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <ScrollView
        style={sideInsets}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        {error && !loaded ? (
          <LoadFailure message={error} onRetry={() => setAttempt((count) => count + 1)} />
        ) : error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}

        {spaceId ? (
          <NativeActionButton
            label={t("Open")}
            onPress={() =>
              void (async () => {
                if (!(await selectSpace(spaceId))) return;
                router.dismissAll();
                router.replace("/");
              })()
            }
          />
        ) : null}

        <SettingsGroup label={t("People")}>
          {loaded?.members.map((member) => (
            <SettingsRow
              key={member.userId}
              accessibilityRole={manager && member.role !== "owner" ? "button" : undefined}
              title={member.name}
              detail={member.email}
              value={roleLabel(member.role)}
              chevron={manager && member.role !== "owner" ? "right" : undefined}
              onPress={manager && member.role !== "owner" ? () => chooseFor(member) : undefined}
            />
          ))}
        </SettingsGroup>

        {manager ? (
          <>
            <SettingsGroup label={t("Invite")}>
              {loaded?.invitations.map((invitation) => (
                <SettingsRow
                  key={invitation.id}
                  title={invitation.email}
                  trailing={
                    <NativeActionButton
                      label={t("Cancel")}
                      size="compact"
                      fill={false}
                      variant="text"
                      disabled={busy}
                      onPress={() =>
                        void run(async () => {
                          await rpc("organizations/cancelInvitation", {
                            invitationId: invitation.id,
                          });
                        })
                      }
                    />
                  }
                />
              ))}
            </SettingsGroup>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder={t("name@company.com")}
              placeholderTextColor={mobileTokens().mutedForeground}
              returnKeyType="send"
              style={styles.input}
            />
            <NativeActionButton
              label={t("Send")}
              disabled={!email.trim() || busy}
              onPress={() =>
                void run(async () => {
                  await rpc("organizations/invite", {
                    organizationId,
                    email: email.trim(),
                    role: "member",
                  });
                  setEmail("");
                })
              }
            />
          </>
        ) : null}

        {loaded && (manager || loaded.memory.content) ? (
          <>
            <SettingsGroup label={t("Company memory")}>
              <SettingsRow title={manager ? t("Company memory") : loaded.memory.content} />
            </SettingsGroup>
            {manager ? (
              <>
                <TextInput
                  value={memoryText}
                  onChangeText={setDraft}
                  multiline
                  maxLength={20000}
                  accessibilityLabel={t("Company memory")}
                  placeholderTextColor={mobileTokens().mutedForeground}
                  style={[styles.input, styles.multiline]}
                />
                <NativeActionButton
                  label={t("Save")}
                  disabled={busy || draft === null || draft === loaded.memory.content}
                  onPress={() =>
                    void run(async () => {
                      await rpc("organizations/setMemory", {
                        organizationId,
                        content: memoryText,
                        expectedRevision: loaded.memory.revision,
                      });
                      setDraft(null);
                    })
                  }
                />
              </>
            ) : null}
          </>
        ) : null}

        {loaded?.proposals.length ? (
          <SettingsGroup label={t("Suggestions")}>
            {loaded.proposals.map((proposal) => (
              <SettingsRow
                key={proposal.id}
                title={proposal.content}
                detail={proposal.proposedBy}
                trailing={
                  manager ? (
                    <>
                      <NativeActionButton
                        label={t("Approve")}
                        size="compact"
                        fill={false}
                        disabled={busy}
                        onPress={() =>
                          void run(async () => {
                            await rpc("organizations/decideMemoryProposal", {
                              proposalId: proposal.id,
                              approve: true,
                            });
                          })
                        }
                      />
                      <NativeActionButton
                        label={t("Reject")}
                        size="compact"
                        fill={false}
                        variant="text"
                        prominence="destructive"
                        disabled={busy}
                        onPress={() =>
                          void run(async () => {
                            await rpc("organizations/decideMemoryProposal", {
                              proposalId: proposal.id,
                              approve: false,
                            });
                          })
                        }
                      />
                    </>
                  ) : undefined
                }
              />
            ))}
          </SettingsGroup>
        ) : null}

        {loaded && !manager ? (
          <>
            <TextInput
              value={note}
              onChangeText={setNote}
              maxLength={4000}
              placeholder={t("Suggest a note")}
              placeholderTextColor={mobileTokens().mutedForeground}
              returnKeyType="send"
              style={styles.input}
            />
            <NativeActionButton
              label={t("Send")}
              disabled={!note.trim() || busy}
              onPress={() =>
                void run(async () => {
                  await rpc("organizations/proposeMemory", {
                    organizationId,
                    content: note.trim(),
                  });
                  setNote("");
                })
              }
            />
          </>
        ) : null}

        {loaded?.events.length ? (
          <SettingsGroup label={t("Activity")}>
            {loaded.events.map((event) => (
              <SettingsRow
                key={event.id}
                title={`${event.actorName} ${eventLabel[event.type] ?? event.type}${
                  event.type === "member.invited" && event.subject ? ` ${event.subject}` : ""
                }`}
                value={new Date(event.createdAt).toLocaleDateString()}
              />
            ))}
          </SettingsGroup>
        ) : null}

        {myRole === "owner" ? (
          <NativeActionButton
            label={t("Delete team")}
            prominence="destructive"
            disabled={busy}
            onPress={() =>
              confirm(t("Delete this team?"), t("Delete team"), async () => {
                await withIdentityConfirmation(() =>
                  rpc("organizations/remove", { organizationId }),
                );
                const { spaceId: personalSpaceId } = await rpc("organizations/personalSpace");
                if (personalSpaceId && (await selectSpace(personalSpaceId))) {
                  router.dismissAll();
                  router.replace("/");
                } else router.back();
              })
            }
          />
        ) : (
          <NativeActionButton
            label={t("Leave team")}
            prominence="destructive"
            disabled={busy}
            onPress={() =>
              confirm(t("Leave this team?"), t("Leave team"), async () => {
                await rpc("organizations/leave", { organizationId });
                router.back();
              })
            }
          />
        )}
        {identityDialog}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles() {
  const tokens = mobileTokens();
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: native.groupedPage },
    content: { width: "100%", padding: 20, gap: 24, paddingBottom: 40 },
    error: { color: tokens.destructive, fontSize: 14 },
    input: {
      backgroundColor: native.fill,
      borderRadius: 11,
      padding: 14,
      color: tokens.foreground,
      fontSize: 16,
    },
    multiline: { minHeight: 140, textAlignVertical: "top" },
  });
}
