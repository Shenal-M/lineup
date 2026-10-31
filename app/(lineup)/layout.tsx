import { LineupApp } from "../../src/components/LineupApp";
// The app shell lives in this shared layout so it stays mounted (with its loaded
// state) while navigating between views. Pages only mark the active route.
export default function LineupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <LineupApp />
      {children}
    </>
  );
}
