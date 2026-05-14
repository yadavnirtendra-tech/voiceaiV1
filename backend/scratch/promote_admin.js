import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function promote() {
  const email = 'yadavnirtendra@gmail.com';
  try {
    const user = await prisma.user.update({
      where: { email },
      data: { isAdmin: true, plan: 'PRO' }
    });
    console.log(`✅ SUCCESS: ${user.email} is now a Super Admin (PRO Plan).`);
  } catch (error) {
    console.error(`❌ FAILED: User with email ${email} not found. Please sign up first!`);
  } finally {
    await prisma.$disconnect();
  }
}

promote();
