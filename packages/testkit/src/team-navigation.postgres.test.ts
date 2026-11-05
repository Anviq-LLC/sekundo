// Copyright 2026 Anviq LLC. All rights reserved.
import type { SpaceNavigation } from "@anviq/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Person } from "./team-harness.js";
import { createTeamHarness } from "./team-harness.js";

const hasDb = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const describeWithDatabase = hasDb ? describe : describe.skip;

const botInput = (name: string) => ({
  name,
  title: "",
  description: "",
  instructions: "",
  notifyOnFinish: false,
});

/** A person's own space and their team's read as one list, and nobody else's chats join it. */
describeWithDatabase("team navigation", () => {
  let harness: Awaited<ReturnType<typeof createTeamHarness>>["harness"];
  let ana: Person;
  let ben: Person;
  let anaTeamBotId: string;
  let anaTeamGroupId: string;
  let anaPersonalBotId: string;
  let benPersonalBotId: string;
  let benPersonalSpaceId: string;

  /** A call in the person's own space, which is what no space header selects. */
  async function personal<T>(person: Person, procedure: string, body: unknown = {}) {
    const response = await harness.handles.app.request(`/rpc/${procedure}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: person.cookie,
        origin: "http://127.0.0.1:5173",
      },
      body: JSON.stringify({ json: body }),
    });
    const text = await response.text();
    if (response.status >= 400) throw new Error(`${procedure} ${response.status}: ${text}`);
    return (JSON.parse(text) as { json: T }).json;
  }

  beforeAll(async () => {
    const created = await createTeamHarness("team-navigation", ["cy", "ana", "ben"]);
    harness = created.harness;
    [, ana, ben] = created.people as [Person, Person, Person];

    const teamBot = await harness.ok<{ id: string }>(ana, "bots/create", botInput("Ana Team Bot"));
    const teamHelper = await harness.ok<{ id: string }>(ana, "bots/create", botInput("Ana Helper"));
    anaTeamBotId = teamBot.id;
    const group = await harness.ok<{ id: string }>(ana, "groups/create", {
      name: "Ana only",
      botIds: [teamBot.id, teamHelper.id],
    });
    anaTeamGroupId = group.id;
    anaPersonalBotId = (await personal<{ id: string }>(ana, "bots/create", botInput("Ana Own"))).id;
    benPersonalBotId = (await personal<{ id: string }>(ben, "bots/create", botInput("Ben Own"))).id;
    benPersonalSpaceId = (await personal<{ spaceId: string }>(ben, "me")).spaceId;
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  function expectUnified(navigation: SpaceNavigation) {
    const ids = navigation.spaces.map((space) => space.id);
    expect(ids).toContain(benPersonalSpaceId);
    expect(ids).toContain(harness.teamSpaceId);
    const team = navigation.spaces.find((space) => space.id === harness.teamSpaceId);
    expect(team?.team).toBe(true);
    expect(team?.name).toBe(`Team ${harness.stamp}`);
    expect(team?.canRename).toBe(false);
    expect(team?.canDelete).toBe(false);
    expect(team?.botCount).toBeUndefined();
    const own = navigation.spaces.find((space) => space.id === benPersonalSpaceId);
    expect(own?.team).toBeUndefined();
    expect(own?.bots.map((bot) => bot.id)).toEqual([benPersonalBotId]);
    const text = JSON.stringify(navigation);
    for (const hidden of [anaTeamBotId, anaTeamGroupId, anaPersonalBotId]) {
      expect(text).not.toContain(hidden);
    }
  }

  it("lists the team beside the personal space from the team", async () => {
    expectUnified(await harness.ok<SpaceNavigation>(ben, "spaces/list"));
  });

  it("lists the team beside the personal space from the personal space", async () => {
    expectUnified(await personal<SpaceNavigation>(ben, "spaces/list"));
  });
});
