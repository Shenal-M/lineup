import { notFound } from "next/navigation";
import { LineupApp } from "../../src/components/LineupApp";
export default async function Page({
  params,
}: {
  params: Promise<{ view: string }>;
}) {
  const { view } = await params;
  if (view !== "search" && view !== "following" && view !== "settings")
    notFound();
  return <LineupApp page={view} />;
}
