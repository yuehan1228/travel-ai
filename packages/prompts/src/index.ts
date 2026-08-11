export {
  MAX_TRIP_PLAN_SYSTEM_PROMPT_LENGTH,
  MAX_TRIP_PLAN_USER_PROMPT_LENGTH,
  TRIP_PLAN_PROMPT_SCHEMA_NAME,
  TRIP_PLAN_PROMPT_VERSION,
} from './trip-plan.prompt-version';
export { TRIP_PLAN_SYSTEM_PROMPT } from './trip-plan.system.prompt';
export { buildTripPlanUserPrompt, type TripPlanPromptContext } from './trip-plan.user.prompt';

export const PROMPTS_PACKAGE_VERSION = '0.1.0';
