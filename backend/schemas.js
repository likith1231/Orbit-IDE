const { z } = require('zod');

// Regex to catch path traversal attempts (e.g. "../", leading slash, or null bytes)
const pathTraversalRegex = /(?:\.\.[/\\])|(?:^[/\\])|(?:\0)|(?:^\.\.$)/;
const safeName = z.string()
  .min(1, 'Name is required')
  .max(255, 'Name must not exceed 255 characters')
  .refine(val => !pathTraversalRegex.test(val) && !/[/\\]/.test(val), 'Invalid characters in name')
  .refine(val => val !== '.' && val !== '..', 'Invalid name');
const safePath = z.string()
  .max(1024, 'Path must not exceed 1024 characters')
  .refine(val => !pathTraversalRegex.test(val) && !val.split('/').includes('..'), 'Invalid characters in path');

const signupSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters long').max(200),
  name: z.string().max(100, 'Name must not exceed 100 characters').optional()
});

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required'),
  password: z.string().min(1, 'Password is required'),
});

const projectSchema = z.object({
  name: z.string()
    .min(1, 'Project name is required')
    .max(100, 'Project name must not exceed 100 characters')
    .refine(val => !pathTraversalRegex.test(val), 'Invalid characters in project name'),
  template: z.string().max(50).optional(),
});

const fileSchema = z.object({
  name: safeName,
  path: safePath.optional(),
  isFolder: z.boolean().optional(),
  language: z.string().max(50).optional(),
  content: z.string().max(2_000_000).optional(),
});

const fileContentSchema = z.object({
  content: z.string().max(2_000_000, 'File is too large (2 MB max)'),
});

const renameSchema = z.object({ name: safeName });

const scaffoldSchema = z.object({
  items: z.array(z.object({
    name: safeName,
    path: safePath.optional(),
    isFolder: z.boolean().optional(),
    language: z.string().max(50).optional(),
    content: z.string().max(2_000_000).optional(),
  })).max(500),
});

const chatMessages = z.array(z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
})).min(1).max(200).refine(
  msgs => msgs.reduce((acc, msg) => acc + msg.content.length, 0) <= 400_000,
  'Conversation is too long — start a new chat.'
);

const aiChatSchema = z.object({
  projectId: z.string().min(1),
  messages: chatMessages,
  activeFile: z.object({ path: z.string().max(1024), content: z.string().max(2_000_000).optional() }).nullish(),
  selection: z.string().max(100_000).nullish(),
  model: z.string().max(100).optional(),
});

const aiDebugSchema = z.object({
  projectId: z.string().min(1),
  filePath: z.string().min(1).max(1024),
  language: z.string().max(50),
  code: z.string().max(2_000_000).optional(),
  error: z.string().max(50_000),
});

const autocompleteSchema = z.object({
  prefix: z.string().max(200_000),
  suffix: z.string().max(200_000).default(''),
  language: z.string().max(50),
});

const codeExecutionSchema = z.object({
  code: z.string().max(2_000_000, 'Code exceeds maximum allowed size').optional(),
  language: z.string().max(50),
  fileName: safeName,
  filePath: safePath.optional(), // folder containing the file
  socketId: z.string().max(100).optional(),
  projectFiles: z.array(z.object({
    name: safeName,
    path: safePath.optional(),
    isFolder: z.boolean().optional(),
    content: z.string().optional()
  })).max(2000).optional()
});

module.exports = {
  signupSchema,
  loginSchema,
  projectSchema,
  fileSchema,
  fileContentSchema,
  renameSchema,
  scaffoldSchema,
  aiChatSchema,
  aiDebugSchema,
  autocompleteSchema,
  codeExecutionSchema
};
