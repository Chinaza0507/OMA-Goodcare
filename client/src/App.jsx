import { Navigate, Route, Routes } from 'react-router-dom'
import Landing from './pages/Landing.jsx'
import SignUp from './pages/SignUp.jsx'
import Login from './pages/Login.jsx'
import Home from './pages/Home.jsx'
import Hospital from './pages/Hospital.jsx'
import HospitalHome from './pages/HospitalHome.jsx'
import Admin from './pages/Admin.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/login" element={<Login />} />
      <Route path="/home" element={<Home />} />
      <Route path="/hospital" element={<Hospital key="register" mode="register" />} />
      <Route path="/hospital/login" element={<Hospital key="login" mode="login" />} />
      <Route path="/hospital/home" element={<HospitalHome />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
