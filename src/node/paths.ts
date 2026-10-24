import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Both the source checkout and prepared distributions retain this directory layout.
export const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
