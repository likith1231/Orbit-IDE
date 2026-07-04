const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { docs, getYDoc } = require('y-websocket/bin/utils');

async function run() {
  const p = await prisma.project.findUnique({ where: { id: 'b54a1f0a-c551-44d5-a5e1-6c9e0c20a23f' } });
  const files = await prisma.file.findMany({ where: { projectId: p.id } });
  for (const f of files) {
    const docName = `${p.id}-${f.id}`;
    const doc = docs.get(docName);
    if (doc) {
      const ytext = doc.getText('monaco');
      console.log(`Doc ${f.name} in memory: ${ytext.toString().length} chars`);
    } else {
      console.log(`Doc ${f.name} NOT IN MEMORY`);
    }
  }
}
run().catch(console.error).finally(() => prisma.$disconnect());
