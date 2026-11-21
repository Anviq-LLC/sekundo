# Organizations

The organization settings page and per-person runs in team spaces come from upstream. This page
describes how an organization behaves on this fork, including what we added: the activity log,
company memory, linked bots and organization keys.

An organization is a company workspace. Anyone who is signed in can create one and becomes its owner. A
person's own workspace, Personal, never changes and is never part of a team.

## People and roles

People join by email invitation only. An owner or admin sends it from Settings, Organization, Members. The email links
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
The list holds only the person's own bots and groups, so nobody sees another member's chats here
either.

## Deleting a team

Only the owner can delete a team, and only once nobody else is in it, so the other people have left
or been removed first. The owner confirms their identity, and the team's spaces, bots, computers, files,
company memory, invitations and activity log are then removed for good. The owner's personal workspace
and their other teams are not touched.

Limits: ten teams created per person and fifty pending invitations per team.

## What stays private

A person's chats with their own bots, and groups made of one person and their bots, belong to that
person. Nobody else in the team can list, read, search, write to or export them, and that includes
owners and admins. There is no setting and no override for this.

## Company memory

One note per organization that every bot in its team spaces reads. Owners and admins edit it and
members suggest additions. See [company memory](./company-memory.md).

## Linked bots

A person can bring their own bot into a team group without moving it. See
[linked bots](./linked-bots.md).

## Activity log

Owners and admins can read what happened in the team: people invited, joined, removed or changed,
ownership handed over, company memory edited and suggestions decided. The log records
who and what, never the text of memory or chats.

## Keys

Team content is sealed with the keys described in [content-encryption.md](../content-encryption.md).
Give a team its own customer-managed key there when the team's administrators must be able to
revoke access to its content.
