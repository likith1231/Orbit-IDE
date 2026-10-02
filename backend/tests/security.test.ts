import request from 'supertest';
import { app } from '../server';
import prisma from '../db';

async function signup(email: string) {
  const res = await request(app).post('/api/auth/signup').send({ email, password: 'password123' });
  const token = res.body.token as string;
  const list = await request(app).get('/api/projects').set('Authorization', `Bearer ${token}`);
  const project = list.body.projects[0];
  const full = await request(app).get(`/api/projects/${project.id}`).set('Authorization', `Bearer ${token}`);
  return { token, project: full.body.project };
}

describe('Access control', () => {
  let a: Awaited<ReturnType<typeof signup>>;
  let b: Awaited<ReturnType<typeof signup>>;

  beforeAll(async () => {
    await prisma.user.deleteMany();
    a = await signup('owner@example.com');
    b = await signup('other@example.com');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each([
    ['post', '/api/ai/chat'],
    ['post', '/api/run'],
    ['post', '/api/chaos'],
    ['get', '/api/containers/list'],
  ])('%s %s requires a login', async (method, path) => {
    const res = await (request(app) as any)[method](path).send({});
    expect(res.status).toBe(401);
  });

  it("does not let one user edit another user's file", async () => {
    const file = a.project.files[0];
    const res = await request(app)
      .put(`/api/projects/${b.project.id}/files/${file.id}`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({ content: 'pwned' });
    expect(res.status).toBe(404);
    const after = await prisma.file.findUnique({ where: { id: file.id } });
    expect(after?.content).not.toBe('pwned');
  });

  it("hides another user's chats and search results", async () => {
    const chats = await request(app).get(`/api/projects/${a.project.id}/chats`).set('Authorization', `Bearer ${b.token}`);
    expect(chats.status).toBe(404);
    const search = await request(app).get(`/api/projects/${a.project.id}/search?q=print`).set('Authorization', `Bearer ${b.token}`);
    expect(search.status).toBe(404);
  });

  it('rejects path traversal in file paths', async () => {
    const res = await request(app)
      .post(`/api/projects/${a.project.id}/files`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ name: 'x.js', path: '../../etc' });
    expect(res.status).toBe(400);
  });

  it('moves children when a folder is renamed', async () => {
    const auth = { Authorization: `Bearer ${a.token}` };
    await request(app).post(`/api/projects/${a.project.id}/files`).set(auth).send({ name: 'util.js', path: 'lib/helpers' });
    const files = (await request(app).get(`/api/projects/${a.project.id}`).set(auth)).body.project.files;
    const lib = files.find((f: any) => f.name === 'lib' && f.isFolder);
    await request(app).patch(`/api/projects/${a.project.id}/files/${lib.id}`).set(auth).send({ name: 'core' }).expect(200);
    const after = (await request(app).get(`/api/projects/${a.project.id}`).set(auth)).body.project.files;
    const paths = after.map((f: any) => (f.path ? `${f.path}/${f.name}` : f.name));
    expect(paths).toEqual(expect.arrayContaining(['core', 'core/helpers', 'core/helpers/util.js']));
    expect(paths.some((p: string) => p.startsWith('lib'))).toBe(false);
  });
});
