import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/auth'

const prisma = new PrismaClient()

async function main() {
  // Create a super admin user (can create invitation codes and manage everything)
  const superAdminUser = await prisma.user.upsert({
    where: { email: 'admin@squady.com' },
    update: {},
    create: {
      email: 'admin@squady.com',
      name: 'Super Admin',
      password: await hashPassword('admin123'),
      role: 'SUPER_ADMIN',
    },
  })

  // Create a sample bidder user
  const bidderUser = await prisma.user.upsert({
    where: { email: 'bidder@squady.com' },
    update: {},
    create: {
      email: 'bidder@squady.com',
      name: 'Sample Bidder',
      password: await hashPassword('bidder123'),
      role: 'BIDDER',
    },
  })

  console.log('Seed data created:', { superAdminUser, bidderUser })
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
