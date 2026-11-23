// Appends to the action log (the table rejects edits and deletes).
export async function logAction(db, { clinicId, actor, action, appt, reason, details }) {
  await db.query(
    `INSERT INTO action_log (clinic_id, actor_id, actor_name, action, appointment_id, patient_name, reason, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      clinicId,
      actor?.id ?? null,
      actor?.name ?? 'system',
      action,
      appt?.id ?? null,
      appt?.patient_name ?? null,
      reason ?? null,
      details ? JSON.stringify(details) : null,
    ],
  )
}
