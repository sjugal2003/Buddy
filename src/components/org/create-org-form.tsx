"use client";

import { useActionState, useEffect, useState } from "react";
import { createOrganization } from "@/app/actions/organizations";
import type { FormState } from "@/app/actions/types";
import { Field, inputClass, primaryButton } from "@/components/ui/form";
import { FieldError, FormMessage } from "@/components/auth/auth-card";

const timeZones = Array.from(new Set(["UTC", ...Intl.supportedValuesOf("timeZone")]));

function toSlug(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function CreateOrganizationForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createOrganization, {});
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [timezone, setTimezone] = useState("UTC");

  // Pick the browser's time zone after the first render, so the server and
  // browser HTML match.
  useEffect(() => {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timeZones.includes(local)) setTimezone(local);
  }, []);

  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage error={state.error} />
      <Field label="Company name">
        <input
          name="name"
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugEdited) setSlug(toSlug(e.target.value));
          }}
          className={inputClass}
        />
        <FieldError message={state.fieldErrors?.name} />
      </Field>
      <Field label="Web address" hint={`Your workspace will be at /w/${slug || "your-company"}. It can't be changed later.`}>
        <input
          name="slug"
          required
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value.toLowerCase());
            setSlugEdited(true);
          }}
          className={`${inputClass} font-mono`}
        />
        <FieldError message={state.fieldErrors?.slug} />
      </Field>
      <Field label="Industry (optional)">
        <input name="industry" className={inputClass} placeholder="For example: Internet service provider" />
        <FieldError message={state.fieldErrors?.industry} />
      </Field>
      <Field label="Time zone">
        <select name="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} className={inputClass}>
          {timeZones.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
        <FieldError message={state.fieldErrors?.timezone} />
      </Field>
      <button type="submit" disabled={pending} className={`${primaryButton} w-full`}>
        {pending ? "Creating workspace…" : "Create workspace"}
      </button>
    </form>
  );
}
