import { PrismaClient } from '@prisma/client'
import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env.local
config({ path: resolve(process.cwd(), '.env.local') })

const prisma = new PrismaClient()

async function main() {
  console.log('Starting bidder purse update...')

  // Find all bidders with purseAmount = 10000000
  const biddersToUpdate = await prisma.bidder.findMany({
    where: {
      purseAmount: 10000000
    },
    select: {
      id: true,
      purseAmount: true,
      remainingPurse: true
    }
  })

  console.log(`Found ${biddersToUpdate.length} bidders with purseAmount = 10,000,000`)

  if (biddersToUpdate.length === 0) {
    console.log('No bidders to update.')
    return
  }

  let updated = 0
  let skipped = 0

  for (const bidder of biddersToUpdate) {
    // Calculate the new remaining purse
    // If they haven't spent anything (remainingPurse = purseAmount), set to 100000
    // Otherwise, calculate the difference and apply the same ratio
    const spent = bidder.purseAmount - bidder.remainingPurse
    const newPurseAmount = 100000
    const newRemainingPurse = Math.max(0, newPurseAmount - spent)

    try {
      await prisma.bidder.update({
        where: { id: bidder.id },
        data: {
          purseAmount: newPurseAmount,
          remainingPurse: newRemainingPurse
        }
      })
      updated++
      console.log(`Updated bidder ${bidder.id}: ${bidder.purseAmount} → ${newPurseAmount}, remaining: ${bidder.remainingPurse} → ${newRemainingPurse}`)
    } catch (error) {
      console.error(`Error updating bidder ${bidder.id}:`, error)
      skipped++
    }
  }

  console.log(`\nUpdate complete!`)
  console.log(`- Updated: ${updated}`)
  console.log(`- Skipped: ${skipped}`)
  console.log(`- Total: ${biddersToUpdate.length}`)
}

main()
  .catch((e) => {
    console.error('Error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

