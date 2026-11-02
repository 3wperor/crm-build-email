import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Payment received" };

export default function SuccessPage() {
  return (
    <main className="bg-background flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle className="text-xl">Thank you!</CardTitle>
          <CardDescription>Payment received. Your account will be activated shortly.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/dashboard" className="text-sm underline underline-offset-4">
            Back to YCAReach
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
