import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function addScheduledStartDateColumn() {
  try {
    console.log('Adding scheduledStartDate column to auctions table...')
    
    // Check if column already exists by trying to query it
    const testAuction = await prisma.$queryRaw`
      SELECT "scheduledStartDate" FROM "auctions" LIMIT 1
    `.catch(() => null)
    
    if (testAuction !== null) {
      console.log('✅ Column scheduledStartDate already exists!')
      return
    }
    
    // Add the column
    await prisma.$executeRaw`
      ALTER TABLE "auctions" ADD COLUMN IF NOT EXISTS "scheduledStartDate" TIMESTAMP(3)
    `
    
    console.log('✅ Successfully added scheduledStartDate column!')
  } catch (error: any) {
    if (error.message?.includes('already exists') || error.message?.includes('duplicate')) {
      console.log('✅ Column scheduledStartDate already exists!')
    } else {
      console.error('❌ Error adding column:', error)
      throw error
    }
  } finally {
    await prisma.$disconnect()
  }
}

addScheduledStartDateColumn()
  .then(() => {
    console.log('Migration completed!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Migration failed:', error)
    process.exit(1)
  })

