import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { ZodError } from 'zod'
import { checkDb } from './db.js'
import { AppError } from './lib/errors.js'
import authRoutes from './routes/auth.js'
import familyRoutes from './routes/family.js'
import clinicRoutes from './routes/clinics.js'
import appointmentRoutes from './routes/appointments.js'
import koloRoutes from './routes/kolo.js'
import hospitalRoutes from './routes/hospitals.js'
import adminRoutes from './routes/admin.js'
import managerRoutes from './routes/manager.js'
import staffRoutes from './routes/staff.js'
import publicRoutes from './routes/public.js'

const app = express()

app.use(helmet())
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }))
app.use(express.json({ limit: '10kb' }))

app.get('/api/health', async (_req, res) => {
  res.json({ status: 'ok', database: await checkDb() })
})

app.use('/api/auth', authRoutes)
app.use('/api/hospitals', hospitalRoutes)
app.use('/api/clinics', clinicRoutes)
app.use('/api/family', familyRoutes)
app.use('/api/appointments', appointmentRoutes)
app.use('/api/kolo', koloRoutes)
app.use('/api/staff', staffRoutes)
app.use('/api/manager', managerRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/public', publicRoutes)

app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }))

// Central error handler (Express 5 forwards async errors here automatically).
// Errors carry a stable `error` code; the client shows the message in the user's language.
app.use((err, _req, res, _next) => {
  if (err instanceof AppError) return res.status(err.status).json({ error: err.code, ...err.extra })
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: err.issues.some((i) => i.message === 'invalid_phone') ? 'invalid_phone' : 'invalid_input',
      details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    })
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'malformed_json' })
  console.error(err)
  res.status(500).json({ error: 'server_error' })
})

export default app
