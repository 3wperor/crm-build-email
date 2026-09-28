import { NextResponse, type NextRequest } from "next/server";
import { resolveUnsubscribe, unsubscribe } from "@/lib/unsubscribe";

/** RFC 8058 one-click unsubscribe (mail clients POST "List-Unsubscribe=One-Click"). */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const target = await resolveUnsubscribe(token);
  if (!target) return new NextResponse("Invalid link", { status: 404 });
  await unsubscribe(target, "one-click");
  return new NextResponse("Unsubscribed", { status: 200 });
}
