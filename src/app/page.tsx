import { redirect } from "next/navigation";
import { listWorkspaces } from "@/lib/data";

export default async function Home() {
  const [first] = await listWorkspaces();
  redirect(`/w/${first.slug}`);
}
