import { plan, overlay, summarize } from '../lib/verify';

const file = (path: string, content = '') => {
  const i = path.lastIndexOf('/');
  return { name: i < 0 ? path : path.slice(i + 1), path: i < 0 ? '' : path.slice(0, i), isFolder: false, content };
};

describe('verification planning', () => {
  it('overlays proposed writes and deletes on the project', () => {
    const map = overlay([file('a.js', 'old'), file('lib/b.js', 'b'), file('lib/c.js', 'c')], {
      writes: [{ path: 'a.js', content: 'new' }, { path: 'd.js', content: 'd' }],
      deletes: ['lib'],
    });
    expect(Object.fromEntries(map)).toEqual({ 'a.js': 'new', 'd.js': 'd' });
  });

  it('prefers the npm test script', () => {
    const map = new Map([['package.json', JSON.stringify({ scripts: { test: 'jest' } })]]);
    expect(plan(map, [], null)?.label).toBe('npm test');
  });

  it('ignores the npm init placeholder test script', () => {
    const map = new Map([['package.json', JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } })], ['index.js', '']]);
    expect(plan(map, ['index.js'], null)?.kind).toBe('compile');
  });

  it('runs pytest when Python tests exist', () => {
    const map = new Map([['app.py', ''], ['tests/test_app.py', '']]);
    expect(plan(map, ['app.py'], null)?.label).toBe('pytest');
  });

  it('runs the requested file when there are no tests', () => {
    const map = new Map([['main.py', 'print(1)']]);
    expect(plan(map, ['main.py'], 'main.py')?.kind).toBe('run');
  });

  it('skips changes that have nothing checkable', () => {
    expect(plan(new Map([['style.css', 'body{}']]), ['style.css'], null)).toBeNull();
  });

  it('summarizes common test runner output', () => {
    expect(summarize('tests', 'Tests:       3 passed, 3 total', true)).toBe('3 passed, 3 total');
    expect(summarize('tests', '==== 2 failed, 5 passed in 0.12s ====', false)).toBe('2 failed, 5 passed');
    expect(summarize('tests', '# pass 4\n# fail 1\n', false)).toBe('4 passed, 1 failed');
  });
});
