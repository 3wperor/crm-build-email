"use client";

import { useMemo } from "react";
import { Input } from "@/components/ui/input";

export function TimezoneInput({
  name,
  id,
  defaultValue,
  placeholder = "Workspace default",
}: {
  name: string;
  id?: string;
  defaultValue?: string | null;
  placeholder?: string;
}) {
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [];
    }
  }, []);
  const listId = `${id ?? name}-zones`;
  return (
    <>
      <Input id={id} name={name} list={listId} defaultValue={defaultValue ?? ""} placeholder={placeholder} autoComplete="off" />
      <datalist id={listId}>
        {zones.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
    </>
  );
}
