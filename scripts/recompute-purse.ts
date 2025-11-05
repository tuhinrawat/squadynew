import { PrismaClient } from '@prisma/client'
import { config as loadEnv } from 'dotenv'
import { existsSync } from 'fs'
import { resolve } from 'path'

// Load .env.local or .env
(() => {
	const root = process.cwd()
	const local = resolve(root, '.env.local')
	if (existsSync(local)) loadEnv({ path: local })
	else loadEnv()
})()

const prisma = new PrismaClient()

async function main() {
	console.log('Recomputing remainingPurse for all bidders based on actual sales...')

	// Fetch all auctions with sold players minimal fields
	const auctions = await prisma.auction.findMany({
		select: {
			id: true,
			bidders: { select: { id: true, purseAmount: true } },
			players: { select: { soldTo: true, soldPrice: true, status: true } },
		},
	})

	for (const auction of auctions) {
		// Sum totals sold per bidder
		const totals = new Map<string, number>()
		for (const p of auction.players) {
			if (p.status === 'SOLD' && p.soldTo && typeof p.soldPrice === 'number') {
				totals.set(p.soldTo, (totals.get(p.soldTo) ?? 0) + p.soldPrice)
			}
		}

		for (const bidder of auction.bidders) {
			const spent = totals.get(bidder.id) ?? 0
			const newRemaining = Math.max(0, bidder.purseAmount - spent)
			await prisma.bidder.update({
				where: { id: bidder.id },
				data: { remainingPurse: newRemaining },
			})
			console.log(`Auction ${auction.id} bidder ${bidder.id}: purse=${bidder.purseAmount} spent=${spent} -> remaining=${newRemaining}`)
		}
	}

	console.log('Done.')
}

main()
	.then(() => prisma.$disconnect())
	.catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
