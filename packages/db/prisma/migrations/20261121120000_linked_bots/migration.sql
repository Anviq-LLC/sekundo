-- A bot can take part in a team space through a link: a thin bot row in that space that points
-- at the person's own bot. Additive: nothing reads the new column until links exist.
ALTER TABLE "bots" ADD COLUMN "linkedFromBotId" TEXT;
ALTER TABLE "bots" ADD CONSTRAINT "bots_linkedFromBotId_fkey"
  FOREIGN KEY ("linkedFromBotId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "bots_linkedFromBotId_idx" ON "bots"("linkedFromBotId");
CREATE UNIQUE INDEX "bots_spaceId_linkedFromBotId_key" ON "bots"("spaceId", "linkedFromBotId")
  WHERE "linkedFromBotId" IS NOT NULL AND "archivedAt" IS NULL;

-- A link points at its owner's own bot in another space, and the owner belongs to the space.
-- Checked here so no code path can create a link across owners. The function runs with its
-- owner's rights because it reads rows of other spaces.
CREATE FUNCTION bots_check_link() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public AS $$
DECLARE
  original RECORD;
BEGIN
  IF NEW."linkedFromBotId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "userId", "spaceId", "linkedFromBotId" AS linked INTO original
    FROM bots WHERE id = NEW."linkedFromBotId";
  IF NOT FOUND OR original."userId" <> NEW."userId" OR original.linked IS NOT NULL
     OR original."spaceId" = NEW."spaceId" THEN
    RAISE EXCEPTION 'A linked bot must point at its owner''s own bot in another space'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM space_members WHERE "spaceId" = NEW."spaceId" AND "userId" = NEW."userId"
  ) THEN
    RAISE EXCEPTION 'The owner must belong to the space the bot is linked into'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bots_check_link BEFORE INSERT OR UPDATE OF "linkedFromBotId", "userId", "spaceId" ON "bots"
FOR EACH ROW EXECUTE FUNCTION bots_check_link();

-- What the team sees of a linked bot follows the original: its name and look, and archiving
-- it. Descriptions and instructions are sealed under their own space's key and stay with the
-- original, as does everything else.
CREATE FUNCTION bots_sync_links() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE bots
     SET name = NEW.name, color = NEW.color, "updatedAt" = now()
   WHERE "linkedFromBotId" = NEW.id
     AND (name, color) IS DISTINCT FROM (NEW.name, NEW.color);
  IF NEW."archivedAt" IS NOT NULL AND OLD."archivedAt" IS NULL THEN
    UPDATE bots SET "archivedAt" = NEW."archivedAt"
     WHERE "linkedFromBotId" = NEW.id AND "archivedAt" IS NULL;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER bots_sync_links AFTER UPDATE OF name, color, "archivedAt" ON "bots"
FOR EACH ROW WHEN (NEW."linkedFromBotId" IS NULL) EXECUTE FUNCTION bots_sync_links();
