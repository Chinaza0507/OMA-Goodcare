// Tells connected screens "the queue changed, refetch". No patient data goes over
// the socket, so clients still fetch the details through the authenticated API.
let io = null

export const setIo = (instance) => {
  io = instance
}

export function emitQueueChanged(clinicId, departmentId) {
  if (!io) return
  io.to(`dept:${departmentId}`).to(`clinic:${clinicId}`).emit('queue:changed', { departmentId })
}
