"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY, type ThemePreference } from "../theme";

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "system", label: "System", Icon: Monitor },
  { value: "dark", label: "Dark", Icon: Moon },
];

/* A three-line external store, so the toggle reads the stored preference
   without a setState-in-effect cascade. */
let cached: ThemePreference | null = null;
const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  if (cached) return cached;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    stored = null;
  }
  cached = stored === "light" || stored === "dark" ? stored : "system";
  return cached;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function writePreference(next: ThemePreference) {
  cached = next;
  const root = document.documentElement;
  if (next === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", next);
  try {
    if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    /* a locked-down browser profile keeps the choice for this session only */
  }
  listeners.forEach((listener) => listener());
}

export function ThemeToggle() {
  const preference = useSyncExternalStore(
    subscribe,
    readPreference,
    () => "system" as ThemePreference,
  );

  return (
    <div
      className="flex items-center gap-0.5 rounded-full border border-line bg-sunken p-0.5"
      role="radiogroup"
      aria-label="Colour theme"
      data-print="hide"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${label} theme`}
            title={`${label} theme`}
            onClick={() => writePreference(value)}
            className={`grid size-7 cursor-pointer place-items-center rounded-full transition-colors ${
              active
                ? "bg-surface text-accent shadow-xs"
                : "text-ink-faint hover:text-ink-soft"
            }`}
          >
            <Icon size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
