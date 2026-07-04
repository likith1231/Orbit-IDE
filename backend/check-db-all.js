const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const pList = await prisma.project.findMany({
    where: { name: 'chaos-sandbox' },
    orderBy: { updatedAt: 'desc' },
    include: { files: true }
  });
  pList.forEach(p => {
    console.log(`Project: ${p.id} updated at ${p.updatedAt}`);
    p.files.forEach(f => {
      console.log(`- ${f.name} (length: ${f.content?.length})`);
    });
  });
}
run().finally(() => prisma.$disconnect());
