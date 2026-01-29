// Test script for stats API
import { Watchtower } from './dist/index.mjs'

const wt = new Watchtower({
  gameId: 'test-game',
  apiKey: 'wt_test_abc123',  // Test key we created earlier
  playerId: 'test-player-sdk'
})

async function main() {
  console.log('Testing Watchtower SDK Stats API\n')
  
  // Track session start
  console.log('1. Tracking session start...')
  await wt.trackSessionStart()
  console.log('   ✓ Session started\n')
  
  // Get game stats
  console.log('2. Getting game stats...')
  const stats = await wt.getStats()
  console.log('   Stats:', JSON.stringify(stats, null, 2))
  console.log()
  
  // Get player stats
  console.log('3. Getting player stats...')
  const playerStats = await wt.getPlayerStats()
  console.log('   Player stats:', JSON.stringify(playerStats, null, 2))
  console.log()
  
  // Using the convenience getter
  console.log('4. Using wt.stats convenience getter...')
  const stats2 = await wt.stats
  console.log(`   ${stats2.online} players online, ${stats2.rooms} active rooms`)
  console.log()
  
  console.log('✓ All tests passed!')
}

main().catch(console.error)
