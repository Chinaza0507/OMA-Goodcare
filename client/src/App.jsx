import { useEffect, useState } from 'react'

export default function App() {
  const [status, setStatus] = useState('checking...')

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => setStatus(data.status))
      .catch(() => setStatus('server unreachable'))
  }, [])

  return (
    <main className="min-h-screen bg-stone-50 flex flex-col items-center justify-center gap-2">
      <h1 className="text-5xl font-bold text-purple-800">ỌMA</h1>
      <p className="text-stone-600">Good Care — Hospital Queue Booking</p>
      <p className="text-sm text-stone-500">API status: {status}</p>
    </main>
  )
}
