import { config as loadEnv } from 'dotenv'
import { existsSync } from 'fs'
import { resolve } from 'path'

// Load environment variables from .env.local if present, else .env
(() => {
	const root = process.cwd()
	const envLocal = resolve(root, '.env.local')
	const envFile = resolve(root, '.env')
	if (existsSync(envLocal)) {
		loadEnv({ path: envLocal })
	} else if (existsSync(envFile)) {
		loadEnv({ path: envFile })
	} else {
		// fallback to default dotenv behavior (no-op if none)
		loadEnv()
	}
})()
import { PrismaClient } from '@prisma/client'

function resolveDatabaseUrl(): string {
	const env = process.env
	const candidates = [
		env.DIRECT_DATABASE_URL,
		env.POSTGRES_URL_NON_POOLING,
		env.POSTGRES_URL,
		env.DATABASE_URL,
	]
	const first = candidates.find(Boolean)
	if (!first) throw new Error('No database URL found. Set DIRECT_DATABASE_URL or POSTGRES_URL or DATABASE_URL')
	if (first.startsWith('prisma+postgres') || first.startsWith('prisma://')) {
		const fallback = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL || env.DIRECT_DATABASE_URL
		if (!fallback) {
			throw new Error('DATABASE_URL uses prisma proxy scheme. Provide a direct Postgres URL in POSTGRES_URL_NON_POOLING or DIRECT_DATABASE_URL to run wipe.')
		}
		return fallback
	}
	return first
}

async function main() {
	// Force Prisma Client to use a direct URL for this maintenance script
	process.env.DATABASE_URL = resolveDatabaseUrl()

	const prisma = new PrismaClient()
	const keepUsers = process.argv.includes('--keep-users')

	console.log('Wiping database...')

	await prisma.$transaction(async (tx) => {
		// Delete in FK-safe order
		await tx.chatMessage.deleteMany({})
		await tx.player.deleteMany({})
		await tx.bidder.deleteMany({})
		await tx.auction.deleteMany({})
		await tx.invitation.deleteMany({})
		if (!keepUsers) {
			await tx.user.deleteMany({})
		}
	})

	console.log('Database wiped successfully' + (keepUsers ? ' (users preserved)' : ''))
}

main()
	.then(() => prisma.$disconnect())
	.catch(async (e) => {
		console.error(e)
		await prisma.$disconnect()
		process.exit(1)
	})
