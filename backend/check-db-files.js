const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const p = await prisma.project.findUnique({ where: { id: 'b54a1f0a-c551-44d5-a5e1-6c9e0c20a23f' }, include: { files: true } });
  console.log(`Project: ${p.id} files count: ${p.files.length}`);
  p.files.forEach(f => {
    console.log(`- id: ${f.id} name: ${f.name} path: ${f.path}`);
  });
}
run().finally(() => prisma.$disconnect());
