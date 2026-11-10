import { getOrgContext } from "@/lib/org";
import { WelcomeFlow } from "./welcome-form";

export const metadata = { title: "Welcome" };

export default async function WelcomePage() {
  const { org } = await getOrgContext();
  return (
    <main className="bg-muted/40 flex min-h-screen items-center justify-center p-4 sm:p-6">
      <WelcomeFlow workspace={org.name} />
    </main>
  );
}
