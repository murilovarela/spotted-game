import { errorCopy, type ErrorCopy } from "@/app/g/[publicId]/error-copy";

/** Codes the edit page's actions emit (publish/unpublish, window, objects, background). */
const MASTER_COPY: ErrorCopy = {
  UNCONFIRMED_OBJECTS: "Every object must be confirmed before publishing — one or more is not confirmed.",
  NO_IMAGE: "Generate the image before publishing.",
  NO_OBJECTS: "Add at least one object before publishing.",
  TOO_MANY_OBJECTS: "This game already has the maximum number of objects.",
  INVALID_WINDOW: "The window is invalid: the start must be in the future and the end after the start.",
  INVALID_INPUT: "Something in that form is not valid: a title of 1–120 characters, a label of 1–60, prompts under 500 characters, and only PNG/JPEG/WebP images.",
  NOT_DRAFT: "Only a draft can be edited. Unpublish the game to change it.",
  NOT_FOUND: "That game or object no longer exists.",
  NOT_MASTER: "Only the game master can do that.",
  UNAUTHENTICATED: "Sign in first.",
};

export const masterErrorCopy = (code: string | undefined): string | null => errorCopy(code, MASTER_COPY);
