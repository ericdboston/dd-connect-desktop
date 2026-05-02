// Single source of truth for the desktop app version string.
// Sourced from package.json so a `npm version` bump propagates without
// needing to touch this file. BUILD_DATE comes from the vite.config.ts
// `define` block which captures the date at build invocation.
import packageJson from '../package.json';

export const APP_VERSION: string = packageJson.version;
export const BUILD_DATE: string = __BUILD_DATE__;
