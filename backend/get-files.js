const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const project = await prisma.project.findFirst({ where: { name: 'chaos-sandbox' }, orderBy: { updatedAt: 'desc' } });
  if (!project) {
    console.log("Project not found");
    return;
  }
  const files = await prisma.file.findMany({ where: { projectId: project.id } });
  console.log("FILES IN DB:");
  files.forEach(f => {
    console.log(`--- ${f.name} ---`);
    console.log(f.content ? f.content : '<empty>');
  });
}
run().catch(console.error).finally(() => prisma.$disconnect());
