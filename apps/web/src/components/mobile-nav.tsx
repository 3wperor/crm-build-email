"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Dialog, DialogDescription, DialogTitle, DialogTrigger, DrawerContent } from "@/components/ui/dialog";

/** Phones: a menu button that opens the sidebar as a slide-out drawer. */
export function MobileNav({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // The page changed: get out of the way.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label="Open menu"
        className="hover:bg-accent focus-visible:ring-ring/50 -ml-1.5 flex size-9 items-center justify-center rounded-md outline-none focus-visible:ring-[3px] md:hidden"
      >
        <Menu className="size-5" />
      </DialogTrigger>
      <DrawerContent
        // A link to the page you're already on changes nothing, so close on any link click too.
        onClick={(e) => (e.target as Element).closest("a") && setOpen(false)}
      >
        <DialogTitle className="sr-only">Menu</DialogTitle>
        <DialogDescription className="sr-only">Go to another part of YCAReach.</DialogDescription>
        {children}
      </DrawerContent>
    </Dialog>
  );
}
