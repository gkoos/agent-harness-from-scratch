import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/core/registry.ts';

test('validates nested properties and rejects extras when configured', () => {
  const schema = { type: 'object', required: ['name'], additionalProperties: false, properties: { name: { type: 'string' }, flags: { type: 'array', items: { type: 'boolean' } } } };
  assert.deepEqual(validate({ name: 'ok', flags: [true] }, schema), []);
  assert.deepEqual(validate({ flags: [1], extra: 2 }, schema), ['$.name: required', '$.flags[0]: expected boolean', '$.extra: unexpected property']);
});
