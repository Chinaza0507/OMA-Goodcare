import { convex } from '../api.js'
import { api as fns } from '../../convex/_generated/api.js'

// Live queue updates from Convex. Pages use it like the old Socket.IO connection:
//   const s = connectSocket(); s.on('connect', () => s.emit('join', { clinicId }))
//   s.on('queue:changed', reload); … s.disconnect()
// Behind it, Convex pushes a new version number whenever that queue changes.
export const LIVE = !!convex

// A slow safety-net refetch on top of the live updates.
export const pollEvery = (ms) => Math.max(ms, 60_000)

export function connectSocket() {
  const handlers = { connect: [], 'queue:changed': [] }
  const unsubs = []
  const fire = (name) => handlers[name]?.forEach((h) => h())
  const socket = {
    on(name, h) { (handlers[name] ??= []).push(h); return socket },
    emit(name, args) {
      if (name !== 'join' || !convex) return socket
      let first = true
      unsubs.push(convex.onUpdate(fns.hospital.version, args ?? {}, () => {
        if (first) { first = false; return } // the first value is the current state, not a change
        fire('queue:changed')
      }))
      return socket
    },
    disconnect() { unsubs.splice(0).forEach((u) => u()) },
  }
  queueMicrotask(() => fire('connect'))
  return socket
}
