import { switchOrganization } from "@/app/(app)/actions";
import type { OrgContext } from "@/lib/org";

export function OrgSwitcher({ ctx }: { ctx: OrgContext }) {
  if (ctx.orgs.length <= 1) {
    return <div className="text-muted-foreground truncate px-2 text-xs font-medium">{ctx.org.name}</div>;
  }
  return (
    <form action={switchOrganization} className="flex gap-1">
      <select
        name="org_id"
        defaultValue={ctx.org.id}
        className="border-input w-full rounded-md border bg-transparent px-2 py-1 text-sm font-semibold"
        aria-label="Workspace"
      >
        {ctx.orgs.map((o) => (
          <option key={o.org.id} value={o.org.id}>
            {o.org.name}
          </option>
        ))}
      </select>
      <button type="submit" className="text-muted-foreground px-1 text-xs hover:underline">
        Go
      </button>
    </form>
  );
}
