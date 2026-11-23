import { AppError } from './errors.js'

// All Kolo money movements. Balances change and the history row is written in the
// same transaction, with the wallet row locked, so the two can never disagree.
async function apply(db, userId, type, amount, appointmentId, dAvailable, dReserved) {
  await db.query('INSERT INTO kolo_wallets (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId])
  const { rows } = await db.query('SELECT * FROM kolo_wallets WHERE user_id = $1 FOR UPDATE', [userId])
  const wallet = rows[0]
  const available = wallet.available_naira + dAvailable
  const reserved = wallet.reserved_naira + dReserved

  if (available < 0) {
    throw new AppError(402, 'kolo_low', { needed: amount, available: wallet.available_naira })
  }
  if (reserved < 0) throw new Error('Kolo reserved balance would go negative')

  await db.query('UPDATE kolo_wallets SET available_naira = $2, reserved_naira = $3 WHERE user_id = $1', [
    userId,
    available,
    reserved,
  ])
  await db.query(
    `INSERT INTO kolo_transactions (user_id, type, amount_naira, appointment_id, available_after, reserved_after)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, type, amount, appointmentId, available, reserved],
  )
  return { available, reserved }
}

export const topUp = (db, userId, amount) => apply(db, userId, 'topup', amount, null, amount, 0)
// Booking: money moves from available to reserved.
export const hold = (db, userId, amount, apptId) => apply(db, userId, 'hold', amount, apptId, -amount, amount)
// Early or hospital cancellation, or a free clinic visit: reserved goes back to available.
export const refund = (db, userId, amount, apptId) => apply(db, userId, 'refund', amount, apptId, amount, -amount)
// Attended a paid visit: the deposit is credited against the consultation fee.
export const deduct = (db, userId, amount, apptId) => apply(db, userId, 'deduct', amount, apptId, 0, -amount)
// Verified no-show: the deposit goes to the hospital.
export const forfeit = (db, userId, amount, apptId) => apply(db, userId, 'forfeit', amount, apptId, 0, -amount)

export async function getBalances(db, userId) {
  const { rows } = await db.query('SELECT available_naira, reserved_naira FROM kolo_wallets WHERE user_id = $1', [userId])
  return { available: rows[0]?.available_naira ?? 0, reserved: rows[0]?.reserved_naira ?? 0 }
}

// Settle a held deposit. Used by every path that ends an appointment.
export async function settleDeposit(db, appt, outcome) {
  if (appt.deposit_status !== 'held') return appt.deposit_status
  const fn = { returned: refund, deducted: deduct, forfeited: forfeit }[outcome]
  await fn(db, appt.booked_by, appt.deposit_naira, appt.id)
  return outcome
}
