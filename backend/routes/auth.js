const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../db');

const validate = require('../middleware/validate');
const { signupSchema, loginSchema } = require('../schemas');
const config = require('../config');

const router = express.Router();
const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'test' ? 1000 : 20, // auth attempts per IP per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts, please try again in 15 minutes' }
});

router.post('/signup', authLimiter, validate(signupSchema), async (req, res) => {
    if (!config.signupEnabled) return res.status(403).json({ error: 'Sign-ups are closed on this server.' });
    const { email, password, name } = req.body;
    try {
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

        const hashed = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({
            data: { email, password: hashed, name },
        });

        // Create a default first project so the user lands somewhere real
        await prisma.project.create({
            data: {
                name: 'chaos-sandbox',
                userId: user.id,
                files: {
                    create: [
                        { name: 'README.md', language: 'markdown', content: '# My first Orbit project\n\n- Press **Ctrl+Enter** to run the active file.\n- Open the terminal with **Ctrl+`** — it runs in your own container.\n- Ask the AI assistant (bottom-right) to build something.\n' },
                        { name: 'main.py', language: 'python', content: 'name = input("What is your name? ")\nprint(f"Hello, {name}! Welcome to Orbit IDE.")\n' },
                    ],
                },
            },
        });

        const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: '7d' });
        res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Signup failed.' });
    }
});

router.post('/login', authLimiter, validate(loginSchema), async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: 'Invalid email or password.' });

        const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: '7d' });
        res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Login failed.' });
    }
});

router.get('/me', require('../middleware/auth'), async (req, res) => {
    const user = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { id: true, email: true, name: true },
    });
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    res.json({ user });
});

module.exports = router;