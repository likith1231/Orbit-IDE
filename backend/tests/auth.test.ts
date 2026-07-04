import request from 'supertest';
import { app } from '../server';
import prisma from '../db';

describe('Auth Routes', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('POST /signup', () => {
    it('creates a user + default project with starter files', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ email: 'test@example.com', password: 'password123' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();

      const user = await prisma.user.findUnique({
        where: { email: 'test@example.com' },
        include: { projects: { include: { files: true } } },
      });

      expect(user).toBeTruthy();
      expect(user?.projects.length).toBe(1);
      expect(user?.projects[0].name).toBe('chaos-sandbox');
      expect(user?.projects[0].files.length).toBeGreaterThan(0);
    });

    it('fails with 409 if email already exists', async () => {
      await request(app)
        .post('/api/auth/signup')
        .send({ email: 'existing@example.com', password: 'password123' });

      const res = await request(app)
        .post('/api/auth/signup')
        .send({ email: 'existing@example.com', password: 'password123' });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/An account with this email already exists/i);
    });

    it('fails with 400 if email or password missing', async () => {
      const resNoEmail = await request(app)
        .post('/api/auth/signup')
        .send({ password: 'password123' });
      expect(resNoEmail.status).toBe(400);

      const resNoPassword = await request(app)
        .post('/api/auth/signup')
        .send({ email: 'test2@example.com' });
      expect(resNoPassword.status).toBe(400);
    });
  });

  describe('POST /login', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/auth/signup')
        .send({ email: 'login@example.com', password: 'password123' });
    });

    it('success returns a valid JWT', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'login@example.com', password: 'password123' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
    });

    it('fails with 401 for wrong password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'login@example.com', password: 'wrongpassword' });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Invalid email or password/i);
    });

    it('fails with 401 for nonexistent email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nonexistent@example.com', password: 'password123' });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Invalid email or password/i);
    });
  });

  describe('GET /me', () => {
    let token: string;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ email: 'me@example.com', password: 'password123' });
      token = res.body.token;
    });

    it('returns user data with a valid token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('me@example.com');
      expect(res.body.user.id).toBeDefined();
    });

    it('returns 401 with no token or an invalid token', async () => {
      const resNoToken = await request(app).get('/api/auth/me');
      expect(resNoToken.status).toBe(401);

      const resInvalidToken = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid.token.here');
      expect(resInvalidToken.status).toBe(401);
    });
  });
});
