import type { SkillContext, SkillResult } from './types';
import { skillRegistry } from './skills';

/**
 * Main dispatcher for all AI tools/skills.
 *
 * @param skillName - The name of the tool to call (e.g., 'list_sources').
 * @param args - Arguments to pass to the tool (parsed from the AI's JSON or tool_calls).
 * @param context - Execution context: store snapshot, actions, and API fetch function.
 * @returns Standardized result: either a plain result string or a permission request.
 */
export async function executeSkill(
  skillName: string,
  args: Record<string, any>,
  context: SkillContext,
): Promise<SkillResult> {
  const handler = skillRegistry[skillName];
  if (!handler) {
    return {
      result: `Unknown tool: "${skillName}". Available tools: ${Object.keys(skillRegistry).join(', ')}`,
    };
  }

  try {
    return await handler(args, context);
  } catch (error: any) {
    // Catch any unexpected errors (network timeouts, validation failures, etc.)
    return {
      result: `⚠️ Error while executing "${skillName}": ${error.message || String(error)}`,
    };
  }
}

/**
 * Legacy alias for backward compatibility (if you still have a single executeTool function).
 * We recommend using executeSkill directly.
 */
export const executeTool = executeSkill;
