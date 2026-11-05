# Teams

A team is a company workspace. Anyone who is signed in can create one and becomes its owner. A
person's own workspace, Personal, never changes and is never part of a team.

## People and roles

People join by email invitation only. An owner or admin sends it from Settings, Team. The email links
to `/accept-invitation/<id>`, and the invitation can be accepted only by the signed-in person whose
verified email it names. It lapses after seven days. Instances without outgoing email cannot deliver
invitations, so configure mail first (see the operations guide).

- **Owner**: everything an admin can do, plus inviting admins, changing roles and handing over
  ownership. Ownership moves to another member in one step, so a team always has an owner.
- **Admin**: invites members, removes people, edits company memory and approves suggestions, and
  reads the team's activity log.
- **Member**: works in the team's spaces, reads company memory and suggests additions.

A person who still has active bots in a team cannot be removed, and cannot leave, until those bots
are archived or deleted. An account that is the only owner of a team with other people cannot be
deleted until the team has another owner.

## One sidebar

The sidebar lists Personal and each team the person belongs to, one header per workspace, so
everything is in view without switching first. Opening a chat in another workspace switches to it.
The list holds only the person's own bots and the groups they host or are in, so nobody sees another
member's chats here either.

## Deleting a team

Only the owner can delete a team, and only once nobody else is in it, so the other people have left
or been removed first. The owner confirms their identity, and the team's spaces, bots, computers, files,
company memory, invitations and activity log are then removed for good. The owner's personal workspace
and their other teams are not touched.

Limits: ten teams created per person, fifty pending invitations per team, fifty people in one shared
chat.

## What stays private

A person's chats with their own bots, and groups made of one person and their bots, belong to that
person. Nobody else in the team can list, read, search, write to or export them, and that includes
owners and admins. There is no setting and no override for this.

## Shared chats

The host of a group can share it with people in the team's space. The people and the bots then write
in one transcript, and each message shows who wrote it.

- A guest can read, follow, send messages and leave. Everything else stays with the host: changing the
  bots, renaming or deleting the group, stopping or clearing it, answering the questions and approvals
  the bots raise, and the bots' own files, notes and memory.
- The bots in the group are the host's. They answer with the host's models and connected apps. A
  message from a guest is handled like any request the owner did not write themselves: approvals
  cannot be skipped on its behalf, bot management tools stay off, and the host's own computer is not
  reachable.
- In a shared chat a bot does not read or write its own notes, its saved memories or its scratchpad, and
  the person's own memory is not loaded. Its routines and taught skills are not offered either. It still reads company memory, so nothing private from the
  host's other chats appears in front of guests.
- A group that already has messages cannot be shared until it is cleared, so something said in
  private is never handed to someone who joins later. Everyone keeps their own reading position.

## Company memory

One note per team that every bot in the team's spaces reads before the person's own memory. Owners
and admins edit it. Members can suggest an addition, and it joins company memory only when an owner or
admin approves it. It is stored like other memory, sealed with the team's general space key, and it
belongs to the team, so no person's memory list or export includes it. It is not given to bots
answering an outside chat channel. The limit is 20,000 characters.

## Activity log

Owners and admins can read what happened in the team: people invited, joined, removed or changed,
ownership handed over, company memory edited, suggestions decided and chats shared. The log records
who and what, never the text of memory or chats.

## Keys

Team content is sealed with the keys described in [content-encryption.md](./content-encryption.md).
Give a team its own customer-managed key there when the team's administrators must be able to
revoke access to its content.
