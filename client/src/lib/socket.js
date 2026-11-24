import { io } from 'socket.io-client'
import { API_URL } from '../api.js'

// Live queue updates. In development Vite forwards /socket.io; in production the
// website (Vercel) and the server live on different addresses, so connect to VITE_API_URL.
export const connectSocket = () => (API_URL ? io(API_URL, { path: '/socket.io' }) : io({ path: '/socket.io' }))
