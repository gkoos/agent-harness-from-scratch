import type { Model } from '../core/types.ts';

export function scriptedModel(responses: Array<Awaited<ReturnType<Model['generate']>>>): Model {
  let index = 0;
  return {
    async generate() {
      const response = responses[index++];
      if (!response) throw new Error('Scripted model exhausted');
      return response;
    }
  };
}
