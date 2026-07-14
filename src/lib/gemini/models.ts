export const ALLOWED_MODELS = ['gemini-3.5-flash', 'gemini-2.5-pro'] as const;
export type AllowedModel = (typeof ALLOWED_MODELS)[number];
export const DEFAULT_MODEL: AllowedModel = 'gemini-3.5-flash';
