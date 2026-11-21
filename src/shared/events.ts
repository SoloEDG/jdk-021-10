import type { Game, GameEvent, GameEventType } from "./types";

/**
 * Append a kitchen event. Events are the tutorial's source of truth for what
 * actually happened in the kitchen (as opposed to which control was clicked).
 */
export function recordEvent(
  g: Game,
  type: GameEventType,
  data: Omit<GameEvent, "id" | "time" | "type"> = {},
): GameEvent {
  const event: GameEvent = {
    id: g.nextEventId++,
    time: g.time,
    type,
    ...data,
  };
  g.events.push(event);
  return event;
}
