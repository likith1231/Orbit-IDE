const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const p = await prisma.project.findUnique({ where: { id: 'b54a1f0a-c551-44d5-a5e1-6c9e0c20a23f' } });
  const files = await prisma.file.findMany({ where: { projectId: p.id } });
  files.forEach(f => {
    console.log(`File: ${f.name} | Path: ${f.path}`);
  });
}
run().catch(console.error).finally(() => prisma.$disconnect());
