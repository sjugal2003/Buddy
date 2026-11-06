// Assigning an issue to a member (improvement after D, step 2). Pure, so it
// can be unit tested. The database checks that the member belongs to the
// issue's company and fills in their name; this only builds the picker.

import type { Role } from "@/lib/data/live";

export type AssigneeOption = { value: string; label: string };

const roleWords: Record<Role, string> = { owner: "Owner", admin: "Admin", member: "Member" };

/**
 * The "Assigned to" choices: Nobody, then each member. Two members with the
 * same name get their role added. An older issue whose name was typed in
 * (not linked to a member) keeps it as a choice until someone picks a member.
 */
export function assigneeOptions(
  members: { userId: string; fullName: string; role: Role }[],
  current: { assigneeId: string | null; assigneeName: string | null },
): { options: AssigneeOption[]; selected: string } {
  const counts = new Map<string, number>();
  for (const m of members) counts.set(m.fullName, (counts.get(m.fullName) ?? 0) + 1);
  const options: AssigneeOption[] = [{ value: "", label: "Nobody" }];
  for (const m of members) {
    options.push({ value: m.userId, label: (counts.get(m.fullName) ?? 0) > 1 ? `${m.fullName} (${roleWords[m.role]})` : m.fullName });
  }
  let selected = "";
  if (current.assigneeId && members.some((m) => m.userId === current.assigneeId)) {
    selected = current.assigneeId;
  } else if (!current.assigneeId && current.assigneeName) {
    options.push({ value: "keep", label: `${current.assigneeName} (not linked to a member)` });
    selected = "keep";
  }
  return { options, selected };
}

