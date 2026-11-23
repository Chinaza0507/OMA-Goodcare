import 'dotenv/config'
import http from 'node:http'
import { Server } from 'socket.io'
import app from './app.js'
import { setIo } from './lib/realtime.js'

const PORT = process.env.PORT || 5001

// Fail fast instead of signing tokens or hashing PINs with a missing or weak secret.
for (const name of ['JWT_SECRET', 'PIN_PEPPER']) {
  if (!process.env[name] || process.env[name].length < 32) {
    console.error(`${name} must be set in server/.env and be at least 32 characters.`)
    process.exit(1)
  }
}

const server = http.createServer(app)

const io = new Server(server, {
  cors: { origin: process.env.CLIENT_URL || 'http://localhost:5173' },
})
setIo(io)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Screens subscribe to a department (patients) or a clinic ("Now serving", front desk).
// The server only sends "queue:changed"; screens then refetch through the normal API.
io.on('connection', (socket) => {
  socket.on('join', ({ departmentId, clinicId } = {}) => {
    if (typeof departmentId === 'string' && UUID.test(departmentId)) socket.join(`dept:${departmentId}`)
    if (typeof clinicId === 'string' && UUID.test(clinicId)) socket.join(`clinic:${clinicId}`)
  })
})

server.listen(PORT, () => {
  console.log(`ỌMA server running on http://localhost:${PORT}`)
})
