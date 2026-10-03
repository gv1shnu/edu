import { z } from "zod";
const id = z.string().uuid();
const session = z.object({ sessionId: id });
export const liveEvents = {
  "session:join": session,
  "presence:ping": session,
  "session:end": session,
  "chat:send": session.extend({
    body: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .refine((v) => !/<[^>]*>|!\[/.test(v), "HTML and images are not allowed"),
    kind: z.enum(["message", "question"]),
  }),
  "chat:delete": session.extend({
    messageId: id.optional(),
    clearAll: z.boolean().optional(),
  }),
  "chat:pin": session.extend({ messageId: id, pinned: z.boolean() }),
  "chat:answer": session.extend({ messageId: id }),
  "chat:setState": session.extend({
    state: z.enum(["open", "paused", "slow", "questions_only"]),
    slowModeS: z.number().int().min(1).max(300).optional(),
  }),
  "chat:mute": session.extend({ userId: id, muted: z.boolean() }),
  "poll:create": session.extend({
    prompt: z.string().min(1).max(1000),
    type: z.enum(["yes_no", "single", "multi", "rating", "short_text"]),
    options: z.array(z.string().max(200)).max(12),
    correct: z.any().optional(),
    anonymous: z.boolean(),
    resultsVisibility: z.enum(["hidden", "after_close", "live"]),
    timerS: z.number().int().min(5).max(3600).nullable().optional(),
  }),
  "poll:open": session.extend({ pollId: id }),
  "poll:close": session.extend({ pollId: id }),
  "poll:reveal": session.extend({ pollId: id }),
  "poll:respond": session.extend({
    pollId: id,
    response: z.union([
      z.string().max(500),
      z.number().min(1).max(5),
      z.array(z.string().max(200)).max(12),
    ]),
  }),
  "confusion:toggle": session.extend({ active: z.boolean() }),
  "confusion:clear": session,
  "pace:vote": session.extend({
    vote: z.enum(["too_slow", "just_right", "too_fast"]),
  }),
  "coldcall:pick": session.extend({ practice: z.boolean().default(false) }),
  "coldcall:outcome": session.extend({
    id,
    outcome: z.enum(["answered", "passed", "absent"]),
  }),
  "coldcall:skip": session.extend({ userId: id, skip: z.boolean() }),
  "exit:create": session.extend({
    prompt: z.string().min(1).max(1000),
    type: z.enum(["short_text", "mcq", "confidence_1_5"]),
    options: z.array(z.string().max(200)),
    required: z.boolean(),
  }),
  "exit:respond": session.extend({
    ticketId: id,
    response: z.union([
      z.string().min(1).max(2000),
      z.number().int().min(1).max(5),
    ]),
    confusedAbout: z.string().max(2000),
  }),
} as const;
export type LiveEvent = keyof typeof liveEvents;
