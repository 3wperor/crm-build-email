import { getOrgContext } from "@/lib/org";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WelcomeForm } from "./welcome-form";

export const metadata = { title: "Welcome" };

export default async function WelcomePage() {
  const { org } = await getOrgContext();
  return (
    <main className="bg-muted/40 flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-xl">Welcome to YCAReach</CardTitle>
          <CardDescription>
            Four quick questions so we can set up {org.name} for you. Your answers pre-fill your first campaign. Skip any you like.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WelcomeForm />
        </CardContent>
      </Card>
    </main>
  );
}
