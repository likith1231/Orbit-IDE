const { z } = require('zod');

// Regex to catch path traversal attempts (e.g. "../", leading slash, or null bytes)
const pathTraversalRegex = /(?:\.\.[/\\])|(?:^[/\\])|(?:\0)/;

const signupSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  name: z.string().max(100, 'Name must not exceed 100 characters').optional()
});

const projectSchema = z.object({
  name: z.string()
    .min(1, 'Project name is required')
    .max(100, 'Project name must not exceed 100 characters')
    .refine(val => !pathTraversalRegex.test(val), 'Invalid characters in project name')
});

const fileSchema = z.object({
  name: z.string()
    .min(1, 'Name is required')
    .max(255, 'Name must not exceed 255 characters')
    .refine(val => !pathTraversalRegex.test(val), 'Invalid characters in name'),
  path: z.string()
    .max(255, 'Path must not exceed 255 characters')
    .refine(val => !pathTraversalRegex.test(val), 'Invalid characters in path')
    .optional(),
  isFolder: z.boolean().optional(),
  language: z.string().optional()
});

const renameSchema = z.object({
  name: z.string()
    .min(1, 'Name is required')
    .max(255, 'Name must not exceed 255 characters')
    .refine(val => !pathTraversalRegex.test(val), 'Invalid characters in name')
});

const aiChatSchema = z.object({
  messages: z.array(
    z.object({
      role: z.string(),
      content: z.string()
    })
  ).refine(msgs => {
    const totalLength = msgs.reduce((acc, msg) => acc + (msg.content || '').length, 0);
    return totalLength <= 10000;
  }, 'Total messages content exceeds 10,000 characters limit'),
  fileTree: z.array(z.any()).optional(),
  activeFile: z.any().optional(),
  model: z.string().optional()
});

const codeExecutionSchema = z.object({
  code: z.string().max(100000, 'Code exceeds maximum allowed size of 100,000 characters'),
  language: z.string().optional(),
  fileName: z.string().optional(),
  error: z.string().optional(), // Used by auto-debug
  socketId: z.string().optional(),
  projectFiles: z.array(z.object({
    name: z.string(),
    path: z.string().optional(),
    isFolder: z.boolean().optional(),
    content: z.string().optional()
  })).optional()
});

module.exports = {
  signupSchema,
  projectSchema,
  fileSchema,
  renameSchema,
  aiChatSchema,
  codeExecutionSchema
};
