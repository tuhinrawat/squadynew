import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/auth'

async function main() {
  const prisma = new PrismaClient()
  
  try {
    // Check if user exists, if so delete and recreate
    const existing = await prisma.user.findUnique({
      where: { email: 'tuhinrawat@controllingsquady.com' }
    })
    
    if (existing) {
      await prisma.user.delete({
        where: { email: 'tuhinrawat@controllingsquady.com' }
      })
    }
    
    // Create a super admin user (can create invitation codes and manage everything)
    const superAdminUser = await prisma.user.create({
      data: {
        email: 'tuhinrawat@controllingsquady.com',
        name: 'Super Admin',
        password: await hashPassword('Hackit#1703_newstartup'),
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
  } finally {
    await prisma.$disconnect()
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
