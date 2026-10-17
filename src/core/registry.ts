import type { Tool, ToolDefinition } from './types.ts';
/** Deliberately limited JSON Schema subset for teaching purposes. */
export function validate(value: unknown, schema: Record<string, unknown>, path = '$'): string[] {
  const errors: string[] = [];
  const type = schema.type;
  if (typeof type !== 'string') return [`${path}: schema must declare a type`];
  const matches = type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
    : type === 'array' ? Array.isArray(value)
    : type === 'integer' ? typeof value === 'number' && Number.isInteger(value)
    : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
    : type === 'null' ? value === null
    : type === 'string' || type === 'boolean' ? typeof value === type : false;
  if (!matches) return [`${path}: expected ${type}`];
  if (Array.isArray(schema.enum) && !schema.enum.some(item => Object.is(item, value))) errors.push(`${path}: not an allowed value`);
  if (type === 'object') {
    const obj = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    for (const key of (schema.required ?? []) as string[]) if (!Object.hasOwn(obj, key)) errors.push(`${path}.${key}: required`);
    for (const [key, item] of Object.entries(obj)) {
      if (Object.hasOwn(properties, key)) errors.push(...validate(item, properties[key]!, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: unexpected property`);
    }
  }
  if (type === 'array' && schema.items && typeof schema.items === 'object') {
    (value as unknown[]).forEach((item, index) => errors.push(...validate(item, schema.items as Record<string, unknown>, `${path}[${index}]`)));
  }
  return errors;
}
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();
  constructor(tools: readonly Tool[]) {
    for (const tool of tools) {
      if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(tool.name)) throw new Error(`Invalid tool name: ${tool.name}`);
      if (this.tools.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
      this.tools.set(tool.name, tool);
    }
  }
  definitions(): ToolDefinition[] { return [...this.tools.values()].map(({ name, description, parameters }) => ({ name, description, parameters })); }
  get(name: string): Tool | undefined { return this.tools.get(name); }
}
