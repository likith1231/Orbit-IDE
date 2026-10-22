// Orbit's agent is restricted to Haiku: the picker offers only Haiku, and any other model a browser asks for
// (an old tab that saved Opus or Sonnet, or a hand-made request) is replaced by it.
const load = (claudeModel?: string) => {
  let ai: { MODELS: { id: string }[]; pickModel: (m?: string) => string } = { MODELS: [], pickModel: () => '' };
  jest.isolateModules(() => {
    if (claudeModel === undefined) delete process.env.CLAUDE_MODEL;
    else process.env.CLAUDE_MODEL = claudeModel;
    ai = require('../lib/ai');
  });
  return ai;
};

describe('model restriction', () => {
  afterEach(() => {
    delete process.env.CLAUDE_MODEL;
  });

  it('offers only Haiku', () => {
    expect(load().MODELS.map((m) => m.id)).toEqual(['claude-haiku-5-5']);
  });

  it.each(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-4-1', 'anything', undefined])('turns a request for %s into Haiku', (m) => {
    expect(load().pickModel(m)).toBe('claude-haiku-5-5');
  });

  it('ignores a non-Haiku CLAUDE_MODEL from the environment', () => {
    expect(load('claude-sonnet-5-5').pickModel(undefined)).toBe('claude-haiku-5-5');
  });
});
