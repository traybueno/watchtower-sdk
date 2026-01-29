// Quick live test of the SDK against production API
import { Watchtower } from './dist/index.mjs'

const API_KEY = 'wt_live_testkey1769632706'

async function test() {
  console.log('🧪 Testing Watchtower SDK against live API\n')
  
  const wt = new Watchtower({
    gameId: 'test-game',
    apiKey: API_KEY,
    playerId: 'sdk-test-player'
  })
  
  // Test 1: Save
  console.log('1. Testing save...')
  try {
    await wt.save('sdk-test', { timestamp: Date.now(), message: 'Hello from SDK!' })
    console.log('   ✅ Save successful\n')
  } catch (e) {
    console.log('   ❌ Save failed:', e.message, '\n')
    return
  }
  
  // Test 2: Load
  console.log('2. Testing load...')
  try {
    const data = await wt.load('sdk-test')
    console.log('   ✅ Load successful:', data, '\n')
  } catch (e) {
    console.log('   ❌ Load failed:', e.message, '\n')
  }
  
  // Test 3: List saves
  console.log('3. Testing listSaves...')
  try {
    const keys = await wt.listSaves()
    console.log('   ✅ Keys:', keys, '\n')
  } catch (e) {
    console.log('   ❌ List failed:', e.message, '\n')
  }
  
  // Test 4: Create room
  console.log('4. Testing createRoom...')
  try {
    const room = await wt.createRoom()
    console.log('   ✅ Room created:', room.code)
    console.log('   Host ID:', room.hostId)
    console.log('   Is host:', room.isHost)
    console.log('   Connected:', room.connected, '\n')
    
    // Test 5: Player state
    console.log('5. Testing player state...')
    room.player.set({ x: 100, y: 200, sprite: 'idle' })
    console.log('   ✅ Player state set:', room.player.get(), '\n')
    
    // Wait a bit for sync
    await new Promise(r => setTimeout(r, 200))
    
    // Disconnect
    room.disconnect()
    console.log('6. Disconnected from room\n')
    
  } catch (e) {
    console.log('   ❌ Room failed:', e.message, '\n')
  }
  
  console.log('🎉 All tests completed!')
}

test().catch(console.error)
