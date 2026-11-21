# Linked bots

A person can bring one of their own bots into a team space without moving it or copying it. The bot
keeps living in its home space with its notes, files and history. The team space gets a link to it.

## Using it

In a team space, open a group and edit its members. The picker lists the group's own bots first, then
the person's bots from their other spaces, each labelled with the space it comes from. Picking one
adds it to the group. Nothing is offered in a personal workspace, or in an organization where the
person is the only member.

A linked bot answers in the group with its own persona and model. Like any bot of that space it works
on the owner's computer there.

## What the team sees

Only the name, title and look of the bot. Its description, instructions, notes, memory and history
stay with the original and are never shown in the team space. The link shows the original's name and
colour and follows later renames.

## Rules

- Only the owner of a bot can link it, and only into a space they belong to.
- A bot is linked into a space once. Linking it again returns the existing link.
- A run of a linked bot reads exactly five things from the original: instructions, model provider,
  model, thinking level and the list of disabled built-in tools. It never rewrites the original, and
  it fails with a clear error if the original has been archived, and archiving the original archives its links.
- When the person leaves or is removed from the organization, their links leave every group, what the
  links were running stops, and the links are archived. The original bots are not touched. Links do
  not count as active bots, so they never block leaving.
- A link never appears in ordinary bot lists, counts or searches. The database layer filters it out
  of every bot query unless the query names `linkedFromBotId`, so a new screen cannot show one by
  accident.

## How it works

| Part | Where |
| --- | --- |
| Linking, listing, run-time lookup | `packages/db/src/linked-bots.ts` |
| Leaving an organization | `packages/db/src/linked-bot-lifecycle.ts`, called from `departSpace` |
| Picker data | `bots.linkable` in `apps/api/src/routes/bots.ts` |
| Group create and update | `resolveGroupBotIds`, which swaps a picked bot for its link and creates the link when missing |
| Picker screen | `MemberPicker` in `apps/web/src/pages/space/GroupPanel.tsx` |
| Run-time persona | `withLinkedBotHome` used from `packages/adapters/src/runs/turn/run-model.ts` |

A link is an ordinary bot row with `linkedFromBotId` set, which is why it can sit in a group, own a
browser profile and run on a computer like any other bot.

## Tests

`packages/testkit/src/linked-bots.postgres.test.ts` covers linking, isolation of the original, leaving
an organization, and that links stay out of ordinary queries.

## Not built

Mobile has no picker yet, and a person's private chat cannot be shared with chosen people. Upstream's
team space chats cover the second need.
