-- Stage 8a: members may set or change an issue's category, like its team.
-- The composite foreign key (organization_id, category_id) still stops a
-- category from another company being used.
grant update (category_id) on public.issues to authenticated;
