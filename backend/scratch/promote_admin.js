import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function updateAdmins() {
  const newAdminEmail = 'nirtendrayadav12@gmail.com';
  try {
    // 1. Remove admin status from everyone
    await prisma.user.updateMany({
      data: { isAdmin: false }
    });
    console.log('✅ All existing Super Admin privileges revoked.');

    // 2. Promote the new admin
    const user = await prisma.user.update({
      where: { email: newAdminEmail },
      data: { isAdmin: true, plan: 'PRO' }
    });
    console.log(`✅ SUCCESS: ${user.email} is now the EXCLUSIVE Super Admin.`);
  } catch (error) {
    console.error(`❌ FAILED: User with email ${newAdminEmail} not found. Please sign up with this email first!`);
  } finally {
    await prisma.$disconnect();
  }
}

updateAdmins();
