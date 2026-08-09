/** Shared constants for the light/dark theme stamp. */

export const THEME_STORAGE_KEY = "family-ledger-theme";

export type ThemePreference = "system" | "light" | "dark";

/**
 * Runs before first paint so a stored preference is applied without a flash.
 * The CSS already resolves the operating-system setting on its own, so this
 * only has to stamp an explicit viewer choice.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var v=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(v==="light"||v==="dark"){document.documentElement.setAttribute("data-theme",v);}}catch(e){}})();`;
