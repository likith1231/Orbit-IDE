const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const p = await prisma.project.findFirst({
    where: { name: 'chaos-sandbox' },
    orderBy: { updatedAt: 'desc' },
    include: { files: true }
  });
  console.log('Project:', p.id);
  p.files.forEach(f => {
    console.log(`- ${f.name} (length: ${f.content?.length}) id: ${f.id}`);
  });
}
run().finally(() => prisma.$disconnect());
