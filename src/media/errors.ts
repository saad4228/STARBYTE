/**
 * Errors whose message is written to be shown to the person who pasted the link.
 *
 * Lives apart from `sources.ts` so the individual source modules can throw it without importing
 * the resolver that imports them.
 */
export class SourceError extends Error {}
